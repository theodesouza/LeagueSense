import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import bundledJson from '../src/core/data/catalog.json'
import traitsJson from '../src/core/data/traits.json'
import rosterJson from '../src/core/data/roster.json'
import type { Catalog, GeneralBuildData, MatchupGuideData } from '@core/build-types'
import { compactItems, compactRunes, compactSpells, makeCatalog, subsetCatalog, SHARDS, VISION_ITEMS } from '@core/catalog'
import { demoGeneral, demoGuide } from '@core/demo-builds'
import { planGame } from '@core/builds'
import { traitsFor, type TraitsTable } from '@core/traits'
import type { ChampionInfo, EloTier, Position } from '@core/types'
import { BuildService, type BuildRequest } from '../src/main/build-service'
import { MemoryCache } from '../src/main/cache'
import { DataDragon } from '../src/main/ddragon'
import { SourceFailure } from '../src/main/errors'
import { ImageStore } from '../src/main/image-store'
import type { LaneMeta, StatsProvider, TableEntries } from '../src/main/sources/provider'

const bundled = bundledJson as unknown as Catalog
const roster = (rosterJson as unknown as { champions: ChampionInfo[] }).champions
const traits = (traitsJson as unknown as { traits: TraitsTable }).traits
const tr = (id: number) => traitsFor(traits, id, roster.find((c) => c.id === id)?.tags)
const idOf = (key: string): number => roster.find((c) => c.key === key)!.id

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const noSleep = (): Promise<void> => Promise.resolve()

/* ------------------------------ catálogo ------------------------------ */

describe('catálogo embutido (Data Dragon pt-BR)', () => {
  it('traz itens, runas, estilos e feitiços; itens de visão e fragmentos existem', () => {
    expect(Object.keys(bundled.items).length).toBeGreaterThan(150)
    expect(Object.keys(bundled.runes).length).toBeGreaterThan(40)
    expect(Object.keys(bundled.styles)).toHaveLength(5)
    expect(bundled.spells[4]?.name).toBe('Flash')
    for (const id of VISION_ITEMS) expect(bundled.items[id], `item ${id}`).toBeDefined()
    expect(Object.keys(SHARDS).map(Number)).toEqual(expect.arrayContaining([5008, 5011, 5013]))
    for (const s of Object.values(SHARDS)) expect(s.icon).toMatch(/^perk-images\/[\w/]+\.png$/)
  })

  it('compactação marca Ferimento Grave e ignora itens de outros modos e fora do Summoner’s Rift', () => {
    const items = compactItems({
      '3165': { name: 'Morello', plaintext: 'x', description: '<mainText>causa <status>40% de Ferimento Grave</status></mainText>', tags: ['SpellDamage'], gold: { total: 2200, purchasable: true } },
      '3089': { name: 'Rabadon', description: '<mainText>+AP</mainText>', gold: { total: 3600, purchasable: true } },
      '323089': { name: 'Modo especial' },
      '7000': { name: 'Só no ARAM', maps: { '11': false, '12': true } }
    } as never)
    expect(items[3165]?.antiHeal).toBe(true)
    expect(items[3089]?.antiHeal).toBe(false)
    expect(items[323089]).toBeUndefined()
    expect(items[7000]).toBeUndefined()
  })

  it('subconjunto contém só o pedido (o que vai por IPC)', () => {
    const c = subsetCatalog(bundled, { items: [3340, 2055, 999999], runes: [8112], spells: [4], styles: [8100] })
    expect(Object.keys(c.items).map(Number).sort()).toEqual([2055, 3340])
    expect(Object.keys(c.runes)).toEqual(['8112'])
    expect(Object.keys(c.spells)).toEqual(['4'])
    expect(Object.keys(c.styles)).toEqual(['8100'])
  })

  it('makeCatalog junta as três fontes', () => {
    const c = makeCatalog('1.0.0', {}, [], {})
    expect(c).toMatchObject({ version: '1.0.0', items: {}, runes: {}, spells: {}, styles: {} })
    expect(compactRunes([]).styles).toEqual({})
    expect(compactSpells({})).toEqual({})
  })
})

describe('Data Dragon: catálogo e dicas', () => {
  const dd = (f: typeof fetch, cache = new MemoryCache()) => new DataDragon({ cache, bundled: { ddragonVersion: '16.20.1', champions: [] }, fetchImpl: f, sleep: noSleep })
  const manyItems = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [String(1000 + i), { name: `Item ${i}`, plain: '', description: '', tags: ['Damage'], gold: { total: 1000, purchasable: true } }]))
  const liveRoutes = (hits: string[]) =>
    vi.fn<typeof fetch>(async (u) => {
      const url = String(u)
      hits.push(url)
      if (url.includes('versions.json')) return json(['16.21.1'])
      if (url.includes('pt_BR/champion.json') || url.includes('en_US/champion.json')) return json({ version: '16.21.1', data: { Ahri: { id: 'Ahri', key: '103', name: 'Ahri', tags: ['Mage'] } } })
      if (url.endsWith('/pt_BR/item.json')) return json({ data: manyItems })
      if (url.endsWith('/pt_BR/runesReforged.json')) return json([{ id: 8100, key: 'Domination', name: 'Dominação', icon: 'perk-images/Styles/7200_Domination.png', slots: [{ runes: [{ id: 8112, key: 'Electrocute', name: 'Eletrocutar', icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png', shortDesc: 'x' }] }] }])
      if (url.endsWith('/pt_BR/summoner.json')) return json({ data: { SummonerFlash: { id: 'SummonerFlash', key: '4', name: 'Flash' } } })
      if (url.endsWith('/pt_BR/champion/Zed.json')) return json({ data: { Zed: { enemytips: ['Dica 1', ' Dica 2 ', ''] } } })
      return new Response('', { status: 404 })
    })

  it('catálogo ao vivo é validado, guardado no cache e reutilizado', async () => {
    const hits: string[] = []
    const cache = new MemoryCache()
    const d = dd(liveRoutes(hits), cache)
    const a = await d.catalog(bundled)
    expect(a.source).toBe('live')
    expect(Object.keys(a.catalog.items)).toHaveLength(80)
    expect(a.catalog.spells[4]?.name).toBe('Flash')
    const b = await dd(liveRoutes(hits), cache).catalog(bundled)
    expect(b.source).toBe('cache')
  })

  it('offline sem cache: usa o catálogo embutido, sem lançar', async () => {
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const r = await dd(down).catalog(bundled)
    expect(r.source).toBe('bundled')
    expect(r.catalog).toBe(bundled)
  })

  it('catálogo ao vivo pequeno demais é rejeitado (cai para o embutido)', async () => {
    const f = vi.fn<typeof fetch>(async (u) => {
      const url = String(u)
      if (url.includes('versions.json')) return json(['16.21.1'])
      if (url.includes('champion.json')) return json({ version: '16.21.1', data: { Ahri: { id: 'Ahri', key: '103', name: 'Ahri', tags: [] } } })
      if (url.endsWith('item.json')) return json({ data: { '1': { name: 'x', gold: { total: 1 } } } })
      if (url.endsWith('runesReforged.json')) return json([])
      return json({ data: {} })
    })
    expect((await dd(f).catalog(bundled)).source).toBe('bundled')
  })

  it('dicas da Riot: limpa vazias, valida a chave e guarda em cache', async () => {
    const hits: string[] = []
    const d = dd(liveRoutes(hits))
    expect(await d.enemyTips('Zed')).toEqual(['Dica 1', 'Dica 2'])
    const n = hits.length
    expect(await d.enemyTips('Zed')).toEqual(['Dica 1', 'Dica 2'])
    expect(hits.length).toBe(n) // segunda vez vem do cache
    expect(await d.enemyTips('../x')).toEqual([])
    expect(await d.enemyTips('Naoexiste')).toEqual([])
  })
})

describe('ImageStore: itens, feitiços e runas', () => {
  const png = Buffer.alloc(200, 1)
  const mk = async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(png, { status: 200 }))
    return { f, store: new ImageStore(await mkdtemp(join(tmpdir(), 'ls-img-')), { fetchImpl: f }) }
  }
  it('URLs corretas por tipo', async () => {
    const { f, store } = await mk()
    await store.get('item', '3089', '16.21.1')
    await store.get('spell', 'SummonerFlash', '16.21.1')
    const key = Buffer.from('perk-images/Styles/Domination/Electrocute/Electrocute.png').toString('base64url')
    await store.get('rune', key, '16.21.1')
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([
      'https://ddragon.leagueoflegends.com/cdn/16.21.1/img/item/3089.png',
      'https://ddragon.leagueoflegends.com/cdn/16.21.1/img/spell/SummonerFlash.png',
      'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Domination/Electrocute/Electrocute.png'
    ])
  })
  it('rejeita chaves suspeitas', async () => {
    const { f, store } = await mk()
    expect(await store.get('item', '../1', '16.21.1')).toBeNull()
    expect(await store.get('item', 'abc', '16.21.1')).toBeNull()
    expect(await store.get('rune', Buffer.from('../../etc/passwd').toString('base64url'), '16.21.1')).toBeNull()
    expect(await store.get('rune', Buffer.from('perk-images/../x.png').toString('base64url'), '16.21.1')).toBeNull()
    expect(await store.get('rune', Buffer.from('https://evil.example/x.png').toString('base64url'), '16.21.1')).toBeNull()
    expect(await store.get('rune', 'a'.repeat(400), '16.21.1')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

/* ------------------------------ BuildService ------------------------------ */

const sets = (ids: number[], play = 100, win = 55) => ({ ids, names: ids.map(String), play, win, pick: 0.2 })
const general = (patch: string | null = '16.21'): GeneralBuildData => ({
  damageType: 'AP',
  core: sets([3118, 4645, 3157], 1842, 971),
  boots: sets([3020], 13000, 6800),
  starter: sets([1056, 2003, 2003], 23000, 11800),
  slot4: [sets([3089])],
  slot5: [sets([3135])],
  slot6: [],
  spells: sets([4, 14]),
  runes: { primaryStyle: 8100, primaryRunes: [8112, 8126, 8138, 8135], secondaryStyle: 8200, secondaryRunes: [8226, 8210], shards: [5008, 5008, 5011], play: 100, win: 55 },
  skills: { order: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E'], play: 100, win: 52 },
  skillPriority: ['Q', 'W', 'E'],
  patch,
  fetchedAt: 0
})
const guide = (opponent: number): MatchupGuideData => ({
  opponent,
  position: 'mid',
  cores: [sets([3118, 3089, 3157], 85, 41)],
  boots: [sets([3020])],
  starters: [sets([1056, 2003])],
  singles: [[], [], [], [], [], []],
  spells: [sets([4, 14])],
  runes: [],
  skills: [],
  tipEn: 'tip',
  laneAdvantage: 'even',
  soloKillAdvantage: null,
  playStyle: 'even',
  gameLengths: [],
  record: { play: 852, win: 423 },
  patch: '16.21',
  fetchedAt: 0
})

class FakeBuilds implements StatsProvider {
  readonly source = 'opgg-mcp' as const
  calls: string[] = []
  fail = new Set<string>()
  gate: Promise<void> | null = null
  async laneMeta(): Promise<LaneMeta> {
    return { byPosition: {}, roleRates: {} }
  }
  async baseAtTier(): Promise<never> {
    throw new Error('x')
  }
  async matchups(): Promise<TableEntries> {
    return { entries: {}, patch: null }
  }
  async synergies(): Promise<TableEntries> {
    return { entries: {}, patch: null }
  }
  async patch(): Promise<string | null> {
    return '16.21'
  }
  async buildGeneral(champion: number, position: Position, tier: EloTier): Promise<GeneralBuildData> {
    this.calls.push(`g:${tier}:${position}:${champion}`)
    if (this.gate) await this.gate
    if (this.fail.has('general')) throw new SourceFailure('opgg', 'timeout', 'timeout')
    return general()
  }
  async matchupGuide(champion: number, opponent: number): Promise<MatchupGuideData> {
    this.calls.push(`m:${champion}:${opponent}`)
    if (this.fail.has('guide')) throw new SourceFailure('opgg', 'http', 'HTTP 503', { status: 503 })
    return guide(opponent)
  }
}

describe('BuildService', () => {
  const req = (over: Partial<BuildRequest> = {}): BuildRequest => ({ champion: 103, position: 'mid', elo: 'EMERALD_PLUS', opponent: 238, ...over })
  const mk = (p = new FakeBuilds(), over: Partial<ConstructorParameters<typeof BuildService>[0]> = {}) => {
    let t = 1_000_000
    const cache = new MemoryCache()
    const svc = new BuildService({ provider: p, cache, catalog: async () => bundled, enemyTips: async () => ['Dica oficial'], currentPatch: () => '16.21', now: () => t, ...over })
    return { p, svc, cache, advance: (ms: number) => (t += ms) }
  }

  it('reúne builds, guia, dicas e um catálogo reduzido, com procedência', async () => {
    const { svc } = mk()
    const b = await svc.get(req())
    expect(b.general?.core?.ids).toEqual([3118, 4645, 3157])
    expect(b.guide?.opponent).toBe(238)
    expect(b.opponentTips).toEqual(['Dica oficial'])
    expect(b.problems).toEqual([])
    expect(b.provenance).toMatchObject({ source: 'opgg-mcp', patch: '16.21', currentPatch: '16.21', tier: 'EMERALD_PLUS', guideTier: 'EMERALD_PLUS', fromCache: false })
    // catálogo reduzido: só o necessário (+ visão e feitiços do planejador)
    const items = Object.keys(b.catalog!.items).map(Number)
    expect(items).toEqual(expect.arrayContaining([3118, 3089, 3020, 3340, 2055]))
    expect(items.length).toBeLessThan(40)
    expect(b.catalog!.runes[8112]).toBeDefined()
    expect(b.catalog!.spells[4]).toBeDefined()
    expect(b.catalog!.styles[8100]).toBeDefined()
  })

  it('segunda chamada vem do cache (marcada) e não repete as consultas', async () => {
    const { svc, p } = mk()
    await svc.get(req())
    const n = p.calls.length
    const b = await svc.get(req())
    expect(p.calls.length).toBe(n)
    expect(b.provenance.fromCache).toBe(true)
  })

  it('cache vencido é renovado; se a fonte falhar, serve o vencido', async () => {
    const { svc, p, advance } = mk()
    await svc.get(req())
    advance(13 * 3_600_000)
    p.fail.add('general')
    const b = await svc.get(req())
    expect(b.general).not.toBeNull() // servido do cache vencido
    expect(b.provenance.fromCache).toBe(true)
  })

  it('falha parcial: guia indisponível não derruba as builds gerais', async () => {
    const p = new FakeBuilds()
    p.fail.add('guide')
    const b = await mk(p).svc.get(req())
    expect(b.general).not.toBeNull()
    expect(b.guide).toBeNull()
    expect(b.problems).toHaveLength(1)
    expect(b.problems[0]!.message).toMatch(/Guia do confronto/)
    expect(b.problems[0]!.action).toBeTruthy()
  })

  it('falha total sem cache: bundle vazio com os problemas explicados', async () => {
    const p = new FakeBuilds()
    p.fail.add('general')
    p.fail.add('guide')
    const b = await mk(p, { catalog: async () => { throw new Error('x') } }).svc.get(req())
    expect(b.general).toBeNull()
    expect(b.guide).toBeNull()
    expect(b.catalog).toBeNull()
    expect(b.problems.length).toBe(3)
  })

  it('sem oponente: não consulta guia nem dicas', async () => {
    const tips = vi.fn(async () => ['x'])
    const { svc, p } = mk(new FakeBuilds(), { enemyTips: tips })
    const b = await svc.get(req({ opponent: null }))
    expect(b.guide).toBeNull()
    expect(tips).not.toHaveBeenCalled()
    expect(p.calls.every((c) => c.startsWith('g:'))).toBe(true)
  })

  it('pedidos iguais em voo são unificados; chaves diferem por oponente e elo', async () => {
    const p = new FakeBuilds()
    let release!: () => void
    p.gate = new Promise<void>((r) => (release = r))
    const { svc } = mk(p)
    const a = svc.get(req())
    const b = svc.get(req())
    release()
    await Promise.all([a, b])
    expect(p.calls.filter((c) => c.startsWith('g:'))).toHaveLength(1)
    expect(svc.keyOf(req())).not.toBe(svc.keyOf(req({ opponent: 157 })))
    expect(svc.keyOf(req())).not.toBe(svc.keyOf(req({ elo: 'GOLD' })))
    const c = await svc.get(req({ opponent: 157 }))
    expect(c.key).toBe(svc.keyOf(req({ opponent: 157 })))
    expect(c.opponent).toBe(157)
  })
})

/* ------------------------------ demonstração ------------------------------ */

describe('builds de demonstração', () => {
  it('são determinísticas e usam itens reais do catálogo', () => {
    const ahri = idOf('Ahri')
    const a = demoGeneral(ahri, tr(ahri), bundled, '16.21')
    const b = demoGeneral(ahri, tr(ahri), bundled, '16.21')
    expect(a).toEqual(b)
    for (const id of [...a.core!.ids, ...a.boots!.ids]) expect(bundled.items[id], `item ${id}`).toBeDefined()
    expect(a.runes?.primaryRunes).toHaveLength(4)
    expect(a.runes?.secondaryRunes).toHaveLength(2)
    expect(a.runes?.shards).toHaveLength(3)
    for (const id of a.runes!.primaryRunes) expect(bundled.runes[id]).toBeDefined()
    expect(a.spells?.ids).toHaveLength(2)
  })

  it('alimentam o planejador: 3 builds completas, com objetivo e comportamento', () => {
    const me = idOf('Ahri')
    const opp = idOf('Zed')
    const bundle = {
      key: 'k', champion: me, position: 'mid' as const, opponent: opp,
      general: demoGeneral(me, tr(me), bundled, '16.21'),
      guide: demoGuide(me, opp, 'mid', tr(me), bundled, '16.21'),
      opponentTips: ['Dica'], catalog: bundled,
      provenance: { source: 'demo' as const, patch: '16.21', currentPatch: '16.21', tier: 'EMERALD_PLUS', guideTier: 'EMERALD_PLUS', fetchedAt: 1, fromCache: false },
      problems: []
    }
    const member = (key: string) => ({ champion: idOf(key), weight: 1, traits: tr(idOf(key)) })
    const plan = planGame({
      champion: me, position: 'mid', nameOf: (i) => roster.find((c) => c.id === i)?.name ?? String(i), traitsOf: tr,
      allies: [member('Leona'), member('Jinx')], enemies: [member('Zed'), member('Garen'), member('Darius')],
      bundle, opponent: { champion: opp, probability: 0.8 }
    })
    expect(plan.builds.map((b) => b.id)).toEqual(['meta', 'confronto', 'adaptada'])
    for (const b of plan.builds) {
      expect(b.items.length).toBeGreaterThanOrEqual(5)
      expect(b.objective.length).toBeGreaterThan(20)
      expect(b.behavior.length).toBe(3)
      expect(b.runes).not.toBeNull()
    }
    expect(plan.matchup?.lines.length).toBeGreaterThan(0)
  })
})
