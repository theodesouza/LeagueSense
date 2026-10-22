import { describe, expect, it, vi } from 'vitest'
import { MemoryCache } from '../src/main/cache'
import { StatsService, TTL } from '../src/main/stats-service'
import { SourceFailure } from '../src/main/errors'
import type { LaneMeta, StatsProvider, TableEntries } from '../src/main/sources/provider'
import { applyStatsUpdate, initialStatsSync } from '../src/shared/stats-sync'
import type { FetchPlan } from '@core/fetch-plan'
import type { BaseStat, EloTier, Position } from '@core/types'

const bs = (play: number, win: number): BaseStat => ({ play, win, roleRate: 0.9, pickRate: 0.05, banRate: 0.01 })

class FakeProvider implements StatsProvider {
  readonly source = 'opgg-mcp' as const
  calls: string[] = []
  failMeta = false
  failFor = new Set<string>()
  gates = new Map<string, Promise<void>>()
  active = 0
  maxActive = 0

  async track<T>(label: string, run: () => T): Promise<T> {
    this.calls.push(label)
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      const gate = this.gates.get(label)
      if (gate) await gate
      else await Promise.resolve()
      if (this.failFor.has(label)) throw new SourceFailure('opgg', 'http', 'HTTP 503', { status: 503 })
      return run()
    } finally {
      this.active--
    }
  }

  laneMeta(): Promise<LaneMeta> {
    return this.track('meta', () => {
      if (this.failMeta) throw new SourceFailure('opgg', 'timeout', 'timeout')
      return {
        byPosition: { top: { 1: bs(5000, 2500) }, mid: { 10: bs(5000, 2600), 11: bs(4000, 2000) } },
        roleRates: { 1: { top: 0.9 }, 10: { mid: 0.9 }, 11: { mid: 0.9 } }
      }
    })
  }
  baseAtTier(champion: number, position: Position, tier: EloTier) {
    return this.track(`base:${tier}:${position}:${champion}`, () => ({ stat: bs(1000, 520), patch: '16.21' }))
  }
  matchups(champion: number, position: Position): Promise<TableEntries> {
    return this.track(`m:${champion}:${position}`, () => ({ entries: { 99: { play: 100, win: 55 } }, patch: '16.21' }))
  }
  synergies(champion: number, mine: Position, ally: Position): Promise<TableEntries> {
    return this.track(`s:${champion}:${mine}:${ally}`, () => ({ entries: { 98: { play: 200, win: 110 } }, patch: null }))
  }
  patch(): Promise<string | null> {
    return this.track('patch', () => '16.21')
  }
}

const plan = (over: Partial<FetchPlan> = {}): FetchPlan => ({
  position: 'mid',
  elo: 'EMERALD_PLUS',
  matchups: [10, 11],
  synergies: [],
  extraBase: [10, 11],
  ...over
})

const mk = (p = new FakeProvider(), cache = new MemoryCache(), now = () => 1_000_000) => ({
  p,
  cache,
  svc: new StatsService({ provider: p, cache, now, emitIntervalMs: 0, currentPatch: () => '16.21' })
})

describe('StatsService', () => {
  it('carrega meta + tabelas e monta instantâneo com procedência', async () => {
    const { svc } = mk()
    await svc.request(plan())
    const snap = svc.snapshot('mid', 'EMERALD_PLUS')!
    expect(snap.baseDefault.mid![10]).toBeDefined()
    expect(snap.matchups['10:mid']!.entries[99]).toEqual({ play: 100, win: 55 })
    expect(snap.provenance).toMatchObject({ source: 'opgg-mcp', patch: '16.21', currentPatch: '16.21', tier: 'EMERALD_PLUS', region: 'global' })
    expect(svc.status().state).toBe('ready')
  })

  it('falha de um item não derruba os demais; estado fica "parcial" com erro explicado', async () => {
    const { p, svc } = mk()
    p.failFor.add('m:10:mid')
    await svc.request(plan())
    const snap = svc.snapshot('mid', 'EMERALD_PLUS')!
    expect(snap.matchups['10:mid']).toBeUndefined()
    expect(snap.matchups['11:mid']).toBeDefined()
    const st = svc.status()
    expect(st.state).toBe('partial')
    expect(st.errors[0]!.message).toMatch(/OP\.GG/)
    expect(st.errors[0]!.action).toBeTruthy()
  })

  it('fonte fora do ar sem cache: erro e nenhum instantâneo; com cache vencido: serve o cache', async () => {
    const a = mk()
    a.p.failMeta = true
    await a.svc.request(plan())
    expect(a.svc.status().state).toBe('error')
    expect(a.svc.snapshot('mid', 'EMERALD_PLUS')).toBeNull()

    // cache preenchido "no passado" e fonte falhando
    const cache = new MemoryCache()
    const good = new FakeProvider()
    const t0 = mk(good, cache, () => 1_000)
    await t0.svc.request(plan())
    const later = () => 1_000 + TTL.meta + 5 * 3_600_000 // muito depois: cache vencido
    const bad = new FakeProvider()
    bad.failMeta = true
    const b = mk(bad, cache, later)
    await b.svc.request(plan())
    const snap = b.svc.snapshot('mid', 'EMERALD_PLUS')!
    expect(snap).not.toBeNull()
    expect(snap.provenance.fromCache).toBe(true)
    expect(snap.provenance.fetchedAt).toBe(1_000)
  })

  it('usa o cache dentro do TTL sem chamar a fonte', async () => {
    const cache = new MemoryCache()
    await mk(new FakeProvider(), cache).svc.request(plan())
    const p2 = new FakeProvider()
    await mk(p2, cache).svc.request(plan())
    expect(p2.calls).toEqual([]) // tudo veio do cache
  })

  it('deduplica chamadas simultâneas do mesmo item', async () => {
    const { p, svc } = mk()
    await Promise.all([svc.request(plan()), svc.request(plan())])
    expect(p.calls.filter((c) => c === 'm:10:mid')).toHaveLength(1)
  })

  it('limita o paralelismo', async () => {
    const { p, svc } = mk()
    await svc.request(plan({ matchups: [1, 2, 3, 4, 5, 6, 7, 8], extraBase: [] }))
    expect(p.maxActive).toBeLessThanOrEqual(3)
  })

  it('requisição nova substitui a antiga: itens ainda não iniciados são descartados', async () => {
    const { p, svc } = mk()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    for (const id of [1, 2, 3]) p.gates.set(`m:${id}:mid`, gate) // ocupa os 3 trabalhadores
    const first = svc.request(plan({ matchups: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], extraBase: [] }))
    await vi.waitFor(() => expect(p.calls.filter((c) => c.startsWith('m:')).length).toBe(3))
    const second = svc.request(plan({ position: 'top', matchups: [1], extraBase: [] }))
    release()
    await Promise.all([first, second])
    const mid = p.calls.filter((c) => c.startsWith('m:') && c.endsWith(':mid'))
    expect(mid).toEqual(['m:1:mid', 'm:2:mid', 'm:3:mid']) // 4..10 nunca foram iniciados
  })

  it('respostas fora de ordem: instantâneo de outro contexto nunca aparece no contexto atual', async () => {
    const { p, svc } = mk()
    const updates: { key: string; hasTopMatchup: boolean; version: number }[] = []
    svc.onUpdate((u) => updates.push({ key: u.contextKey, hasTopMatchup: !!u.snapshot?.matchups['1:top'], version: u.version }))
    let releaseTop!: () => void
    p.gates.set('m:1:top', new Promise<void>((r) => (releaseTop = r)))
    const slow = svc.request(plan({ position: 'top', matchups: [1], extraBase: [] })) // lento (posição antiga)
    await vi.waitFor(() => expect(p.calls).toContain('m:1:top'))
    await svc.request(plan({ position: 'mid' })) // rápido (posição atual)
    releaseTop() // resposta atrasada da posição antiga chega por último
    await slow

    // snapshot do contexto atual (mid) não contém tabelas de top
    const snapMid = svc.snapshot('mid', 'EMERALD_PLUS')!
    expect(Object.keys(snapMid.matchups).every((k) => k.endsWith(':mid'))).toBe(true)

    // a interface descarta atualizações de outro contexto e as mais antigas
    let state = initialStatsSync
    const expected = svc.contextKey('mid', 'EMERALD_PLUS')
    for (const u of updates) {
      state = applyStatsUpdate(state, expected, { contextKey: u.key, version: u.version, snapshot: null })
    }
    expect(state.contextKey).toBe(expected)
    const v = state.version
    // reenvio de uma versão antiga não regride o estado
    expect(applyStatsUpdate(state, expected, { contextKey: expected, version: v - 1, snapshot: null })).toBe(state)
    // atualização de outro contexto (posição trocada) é ignorada
    expect(applyStatsUpdate(state, expected, { contextKey: svc.contextKey('top', 'EMERALD_PLUS'), version: v + 10, snapshot: null })).toBe(state)
  })

  it('elo diferente do padrão busca a base por campeão e monta base própria', async () => {
    const { p, svc } = mk()
    await svc.request(plan({ elo: 'GOLD' }))
    expect(p.calls).toContain('base:GOLD:mid:10')
    const snap = svc.snapshot('mid', 'GOLD')!
    expect(snap.base.mid![10]).toMatchObject({ play: 1000, win: 520 })
    expect(snap.provenance.tier).toBe('GOLD')
    expect(snap.provenance.tableTier).toBe('EMERALD_PLUS')
  })

  it('tabela vencida é buscada de novo; tabela fresca não', async () => {
    let now = 1_000_000
    const p = new FakeProvider()
    const svc = new StatsService({ provider: p, cache: new MemoryCache(), now: () => now, emitIntervalMs: 0 })
    await svc.request(plan({ matchups: [10], extraBase: [] }))
    await svc.request(plan({ matchups: [10], extraBase: [] }))
    expect(p.calls.filter((c) => c === 'm:10:mid')).toHaveLength(1)
    now += TTL.table + 1000
    await svc.request(plan({ matchups: [10], extraBase: [] }))
    expect(p.calls.filter((c) => c === 'm:10:mid')).toHaveLength(2)
  })

  it('patch ausente não é guardado em cache e é buscado de novo na próxima requisição', async () => {
    const p = new FakeProvider()
    let n = 0
    p.patch = () => p.track('patch', () => (n++ === 0 ? null : '16.21'))
    const { svc } = mk(p)
    await svc.request(plan({ matchups: [], extraBase: [] }))
    expect(svc.snapshot('mid', 'EMERALD_PLUS')!.provenance.patch).toBeNull()
    await svc.request(plan({ matchups: [], extraBase: [] }))
    expect(svc.snapshot('mid', 'EMERALD_PLUS')!.provenance.patch).toBe('16.21')
  })

  it('reset limpa memória e cache', async () => {
    const { p, svc } = mk()
    await svc.request(plan())
    await svc.reset()
    expect(svc.snapshot('mid', 'EMERALD_PLUS')).toBeNull()
    const before = p.calls.length
    await svc.request(plan())
    expect(p.calls.length).toBeGreaterThan(before)
  })

  it('sinergias entram no instantâneo por par de rotas', async () => {
    const { svc } = mk()
    await svc.request(plan({ synergies: [{ champion: 10, allyPosition: 'support' }] }))
    expect(svc.snapshot('mid', 'EMERALD_PLUS')!.synergies['10:mid:support']!.entries[98]).toEqual({ play: 200, win: 110 })
  })
})
