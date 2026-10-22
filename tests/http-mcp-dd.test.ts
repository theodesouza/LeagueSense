import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MemoryCache } from '../src/main/cache'
import { DiskCache } from '../src/main/disk-cache'
import { DataDragon, patchOf } from '../src/main/ddragon'
import { describeFailure, SourceFailure } from '../src/main/errors'
import { httpJson, httpRequest } from '../src/main/http'
import { ImageStore } from '../src/main/image-store'
import { McpClient } from '../src/main/sources/opgg/mcp'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

const noSleep = (): Promise<void> => Promise.resolve()

describe('httpRequest', () => {
  it('repete em 503 e devolve o sucesso', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('x', { status: 503 })).mockResolvedValueOnce(json({ ok: 1 }))
    const r = await httpJson<{ ok: number }>('opgg', 'https://x.test', { fetchImpl: f, sleep: noSleep })
    expect(r.ok).toBe(1)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('não repete em 4xx e classifica como http', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 404 }))
    await expect(httpRequest('opgg', 'https://x.test', { fetchImpl: f, sleep: noSleep })).rejects.toMatchObject({ kind: 'http', status: 404 })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('429 respeita Retry-After', async () => {
    const sleeps: number[] = []
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(json({}))
    await httpRequest('opgg', 'https://x.test', { fetchImpl: f, sleep: async (ms) => void sleeps.push(ms) })
    expect(sleeps).toEqual([3000])
  })

  it('falha de rede e timeout viram SourceFailure classificados, após esgotar tentativas', async () => {
    const net = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))
    await expect(httpRequest('ddragon', 'https://x.test', { fetchImpl: net, sleep: noSleep, retries: 1 })).rejects.toMatchObject({ kind: 'network' })
    expect(net).toHaveBeenCalledTimes(2)
    const to = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('t', 'TimeoutError'))
    await expect(httpRequest('ddragon', 'https://x.test', { fetchImpl: to, sleep: noSleep, retries: 0 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('JSON inválido vira parse', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 }))
    await expect(httpJson('opgg', 'https://x.test', { fetchImpl: f })).rejects.toMatchObject({ kind: 'parse' })
  })

  it('mensagens de erro explicam o problema e a ação, sem vazar URL', () => {
    for (const kind of ['timeout', 'network', 'rate-limit', 'http', 'parse', 'validation', 'unavailable'] as const) {
      const d = describeFailure('opgg', kind, 503)
      expect(d.message.length).toBeGreaterThan(10)
      expect(d.action.length).toBeGreaterThan(10)
      expect(d.message + d.action).not.toMatch(/https?:\/\//)
    }
  })
})

describe('McpClient', () => {
  const rpc = (id: number, text: string): Response =>
    json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })

  function server(opts: { sse?: boolean; expireOnce?: boolean } = {}) {
    const seen: { method: string; sid: string | null }[] = []
    let expired = false
    let active = 0
    let maxActive = 0
    const f = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init!.body)) as { id?: number; method: string }
      const sid = (init!.headers as Record<string, string>)['Mcp-Session-Id'] ?? null
      seen.push({ method: body.method, sid })
      if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: body.id, result: {} }, { headers: { 'mcp-session-id': 'S1', 'content-type': 'application/json' } })
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (opts.expireOnce && !expired) {
        expired = true
        return new Response('session not found', { status: 404 })
      }
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      if (opts.sse) {
        return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'viaSSE' }] } })}\n\n`, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      }
      return rpc(body.id!, 'pong')
    })
    return { f, seen, maxActive: () => maxActive }
  }

  it('faz handshake uma vez e reutiliza o id de sessão', async () => {
    const s = server()
    const c = new McpClient({ fetchImpl: s.f, sleep: noSleep })
    expect(await c.callTool('t', {})).toBe('pong')
    await c.callTool('t', {})
    expect(s.seen.filter((x) => x.method === 'initialize')).toHaveLength(1)
    expect(s.seen.filter((x) => x.method === 'tools/call').every((x) => x.sid === 'S1')).toBe(true)
  })

  it('entende respostas em SSE', async () => {
    const c = new McpClient({ fetchImpl: server({ sse: true }).f, sleep: noSleep })
    expect(await c.callTool('t', {})).toBe('viaSSE')
  })

  it('recomeça a sessão quando ela expira', async () => {
    const s = server({ expireOnce: true })
    const c = new McpClient({ fetchImpl: s.f, sleep: noSleep })
    expect(await c.callTool('t', {})).toBe('pong')
    expect(s.seen.filter((x) => x.method === 'initialize')).toHaveLength(2)
  })

  it('limita chamadas simultâneas', async () => {
    const s = server()
    const c = new McpClient({ fetchImpl: s.f, sleep: noSleep, concurrency: 2 })
    await Promise.all(Array.from({ length: 8 }, () => c.callTool('t', {})))
    expect(s.maxActive()).toBeLessThanOrEqual(2)
  })

  it('erro de validação do servidor não é repetido e vira validation', async () => {
    const f = vi.fn<typeof fetch>(async (_u, init) => {
      const b = JSON.parse(String(init!.body)) as { id?: number; method: string }
      if (b.method === 'initialize') return json({ jsonrpc: '2.0', id: b.id, result: {} })
      if (b.method.startsWith('notifications')) return new Response(null, { status: 202 })
      return json({ jsonrpc: '2.0', id: b.id, error: { code: -32600, message: '{"tier":["inválido"]}' } })
    })
    const c = new McpClient({ fetchImpl: f, sleep: noSleep })
    await expect(c.callTool('t', {})).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('DataDragon', () => {
  const bundled = { ddragonVersion: '16.20.1', champions: [{ id: 1, key: 'Annie', name: 'Annie', nameEn: 'Annie', tags: ['Mage'] }] }
  const file = (names: Record<string, [string, string]>) => ({
    version: '16.21.1',
    data: Object.fromEntries(Object.entries(names).map(([id, [key, name]]) => [id, { id, key, name, tags: ['Mage'] }]))
  })
  const router = (map: Record<string, () => Response>) =>
    vi.fn<typeof fetch>(async (u) => {
      for (const [k, v] of Object.entries(map)) if (String(u).includes(k)) return v()
      return new Response('', { status: 404 })
    })

  it('busca ao vivo, junta pt-BR com nomes em inglês e grava no cache', async () => {
    const cache = new MemoryCache()
    const f = router({
      'versions.json': () => json(['16.21.1', '16.20.1']),
      'pt_BR/champion.json': () => json(file({ MonkeyKing: ['62', 'Wukong'], Ahri: ['103', 'Ahri'] })),
      'en_US/champion.json': () => json(file({ MonkeyKing: ['62', 'Wukong'], Ahri: ['103', 'Ahri'] }))
    })
    const r = await new DataDragon({ cache, bundled, fetchImpl: f, sleep: noSleep }).roster()
    expect(r).toMatchObject({ version: '16.21.1', patch: '16.21', source: 'live' })
    expect(r.champions.map((c) => c.id)).toEqual([62, 103])
    expect((await cache.get('ddragon:roster:16.21.1'))?.value).toBeTruthy()
  })

  it('offline com cache: usa o cache; sem nada: usa a lista embutida', async () => {
    const cache = new MemoryCache()
    await cache.set('ddragon:versions', ['16.21.1'], 1)
    await cache.set('ddragon:roster:16.21.1', bundled.champions, 1)
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const a = await new DataDragon({ cache, bundled, fetchImpl: down, sleep: noSleep }).roster()
    expect(a.source).toBe('cache')
    const b = await new DataDragon({ cache: new MemoryCache(), bundled, fetchImpl: down, sleep: noSleep }).roster()
    expect(b).toMatchObject({ source: 'bundled', version: '16.20.1' })
  })

  it('resposta com formato inesperado cai para a lista embutida (sem lançar)', async () => {
    const f = router({ 'versions.json': () => json(['16.21.1']), 'champion.json': () => json({ foo: 1 }) })
    const r = await new DataDragon({ cache: new MemoryCache(), bundled, fetchImpl: f, sleep: noSleep }).roster()
    expect(r.source).toBe('bundled')
  })

  it('patchOf', () => {
    expect(patchOf('16.21.1')).toBe('16.21')
    expect(patchOf(null)).toBeNull()
  })
})

describe('ImageStore', () => {
  const png = Buffer.alloc(500, 1)
  it('baixa uma vez, grava em disco e serve do disco depois', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ls-img-'))
    const f = vi.fn<typeof fetch>(async () => new Response(png, { status: 200 }))
    const store = new ImageStore(dir, { fetchImpl: f })
    const a = await store.get('square', 'Ahri', '16.21.1')
    expect(a?.mime).toBe('image/png')
    const b = await store.get('square', 'Ahri', '16.21.1')
    expect(b?.data.length).toBe(500)
    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0]![0])).toBe('https://ddragon.leagueoflegends.com/cdn/16.21.1/img/champion/Ahri.png')
  })

  it('splash usa URL sem versão e jpeg', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ls-img-'))
    const f = vi.fn<typeof fetch>(async () => new Response(png, { status: 200 }))
    const r = await new ImageStore(dir, { fetchImpl: f }).get('splash', 'Ahri', '16.21.1')
    expect(r?.mime).toBe('image/jpeg')
    expect(String(f.mock.calls[0]![0])).toBe('https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Ahri_0.jpg')
  })

  it('rejeita chaves/versões suspeitas (path traversal) e nunca lança em falha de rede', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ls-img-'))
    const f = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const store = new ImageStore(dir, { fetchImpl: f })
    expect(await store.get('square', '../../etc/passwd', '16.21.1')).toBeNull()
    expect(await store.get('square', 'Ahri', '../x')).toBeNull()
    expect(await store.get('square', 'Ahri', '16.21.1')).toBeNull()
    expect(f).toHaveBeenCalledTimes(2) // 1 tentativa + 1 retry; nenhuma para as chaves inválidas
  })
})

describe('DiskCache', () => {
  it('ida e volta, arquivo corrompido vira miss, clear por prefixo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ls-cache-'))
    const c = new DiskCache(dir)
    await c.set('a:1', { x: 1 }, 42)
    expect(await c.get('a:1')).toEqual({ value: { x: 1 }, fetchedAt: 42 })
    await writeFile(join(dir, 'bad.json'), '{not json')
    expect(await c.get('bad')).toBeNull()
    await c.set('b:1', 1, 1)
    await c.clear('a')
    expect(await c.get('a:1')).toBeNull()
    expect(await c.get('b:1')).not.toBeNull()
    expect((await readdir(dir)).some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})

describe('SourceFailure', () => {
  it('só 5xx/timeout/rede/429 são repetíveis', () => {
    expect(new SourceFailure('opgg', 'http', 'x', { status: 503 }).retryable).toBe(true)
    expect(new SourceFailure('opgg', 'http', 'x', { status: 404 }).retryable).toBe(false)
    expect(new SourceFailure('opgg', 'validation', 'x').retryable).toBe(false)
  })
})
