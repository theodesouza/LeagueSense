import { describe, expect, it } from 'vitest'
import { recommend } from '@core/engine'
import { CONFIG } from '@core/config'
import { DEFAULT_PREFERENCES } from '@core/types'
import { draftWith, id, input, makeStats, makeTraits, NOW, prefs, provenance, stat } from './helpers'

const ids = (r: ReturnType<typeof recommend>): number[] => r.items.map((i) => i.championId)

describe('exclusões', () => {
  it('nunca recomenda campeões banidos nem escolhidos (confirmados) por qualquer time', () => {
    const draft = draftWith({
      allies: { 1: ['Alfa', 'locked'] },
      enemies: { 0: ['Beta', 'locked'] },
      bansAllies: ['Delta'],
      bansEnemies: ['Gama']
    })
    const r = recommend(input({ draft }))
    for (const n of ['Alfa', 'Beta', 'Delta', 'Gama']) expect(ids(r)).not.toContain(id(n))
    expect(r.excludedCount).toBe(4)
    expect(r.items.length).toBeGreaterThan(0)
  })

  it('seleção temporária de aliado não exclui o campeão, mas avisa', () => {
    const draft = draftWith({ allies: { 1: ['Alfa', 'hover'] } })
    const r = recommend(input({ draft }))
    const alfa = r.items.find((i) => i.championId === id('Alfa'))
    expect(alfa).toBeDefined()
    expect(alfa!.caveats.some((c) => c.kind === 'ally-hover')).toBe(true)
  })

  it('respeita excluídos e posse conhecida pelo cliente', () => {
    const r = recommend(
      input({
        prefs: prefs({ excluded: [id('Alfa')], hideUnowned: true }),
        player: { owned: [id('Beta'), id('Gama'), id('Delta')], mastery: {} }
      })
    )
    expect(ids(r).every((c) => [id('Beta'), id('Gama'), id('Delta')].includes(c))).toBe(true)
  })

  it('posse desconhecida não filtra nada', () => {
    const r = recommend(input({ player: { owned: null, mastery: {} } }))
    expect(r.items.length).toBe(5)
  })
})

describe('draft incompleto', () => {
  it('funciona com draft vazio, só com bans, ou só com inimigos', () => {
    expect(recommend(input()).items.length).toBe(5)
    expect(recommend(input({ draft: draftWith({ bansEnemies: ['Alfa', 'Beta'] }) })).items.length).toBe(5)
    expect(recommend(input({ draft: draftWith({ enemies: { 2: ['Eco', 'locked'] } }) })).items.length).toBe(5)
  })

  it('sem posição definida não recomenda (e diz por quê)', () => {
    const r = recommend(input({ position: null }))
    expect(r.status).toBe('no-position')
    expect(r.items).toEqual([])
  })

  it('limita a cinco itens, ordenados por adequação', () => {
    const r = recommend(input())
    expect(r.items.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < r.items.length; i++) expect(r.items[i - 1]!.score).toBeGreaterThanOrEqual(r.items[i]!.score - CONFIG.rankHysteresis)
  })
})

describe('pool restrita', () => {
  it('só mostra campeões da pool; campeão da pool sem estatística entra como dados insuficientes', () => {
    const r = recommend(
      input({
        prefs: prefs({ restrictToPool: true, pool: { [id('Beta')]: 3, [id('Tango')]: 2 } })
      })
    )
    expect(ids(r).sort()).toEqual([id('Beta'), id('Tango')].sort())
    const tango = r.items.find((i) => i.championId === id('Tango'))!
    expect(tango.quality).toBe('insufficient')
    expect(tango.caveats.some((c) => c.kind === 'no-stats')).toBe(true)
  })

  it('familiaridade maior eleva a pontuação; peso "conforto" amplifica', () => {
    const base = recommend(input({ prefs: prefs({ pool: { [id('Gama')]: 4 } }) }))
    const none = recommend(input())
    const withPool = base.items.find((i) => i.championId === id('Gama'))
    expect(withPool).toBeDefined()
    expect(withPool!.factors.some((f) => f.kind === 'familiarity' && f.pp > 2)).toBe(true)
    const heavy = recommend(input({ prefs: prefs({ pool: { [id('Gama')]: 4 }, familiarityWeight: 1.5 }) }))
    const lite = recommend(input({ prefs: prefs({ pool: { [id('Gama')]: 4 }, familiarityWeight: 0.5 }) }))
    const f = (r: ReturnType<typeof recommend>) => r.items.find((i) => i.championId === id('Gama'))!.factors.find((x) => x.kind === 'familiarity')!.pp
    expect(f(heavy)).toBeGreaterThan(f(lite))
    expect(none.items.find((i) => i.championId === id('Gama'))).toBeUndefined() // WR baixo sem pool fica fora do top 5
  })

  it('maestria do cliente só é usada quando o usuário não definiu familiaridade', () => {
    const player = { owned: null, mastery: { [id('Delta')]: { points: 150_000, level: 10 }, [id('Alfa')]: { points: 150_000, level: 10 } } }
    const r = recommend(input({ prefs: prefs({ pool: { [id('Alfa')]: 1 } }), player }))
    const alfa = r.items.find((i) => i.championId === id('Alfa'))!
    const delta = r.items.find((i) => i.championId === id('Delta'))!
    expect(alfa.familiarity.source).toBe('pool')
    expect(delta.familiarity.source).toBe('maestria')
    expect(delta.factors.filter((f) => f.kind === 'familiarity')).toHaveLength(1)
  })
})

describe('estatísticas ausentes ou pequenas', () => {
  it('amostra pequena é encolhida para a média e sinalizada', () => {
    const big = recommend(input({ stats: makeStats({ mid: { Alfa: stat(20000, 0.56) } }) }))
    const small = recommend(input({ stats: makeStats({ mid: { Alfa: stat(250, 0.56) } }) }))
    const pp = (r: ReturnType<typeof recommend>) => r.items.find((i) => i.championId === id('Alfa'))
    const bigAlfa = pp(big)!
    expect(bigAlfa.factors.find((f) => f.kind === 'base')!.pp).toBeGreaterThan(4)
    // 250 partidas: fica fora do top-5 (candidato geral exige 200+, mas pontua pouco)
    const smallItem = small.items.find((i) => i.championId === id('Alfa'))
    if (smallItem) {
      expect(smallItem.factors.find((f) => f.kind === 'base')!.pp).toBeLessThan(1.5)
      expect(smallItem.quality).toBe('insufficient')
    }
    expect(bigAlfa.quality).not.toBe('insufficient')
  })

  it('sem nenhuma estatística (fonte fora do ar): usa composição e pool; sem nenhum sinal não inventa uma lista', () => {
    const traits = makeTraits({ Alfa: { positions: ['mid'] }, Beta: { positions: ['mid'] }, Tango: { positions: ['top'] } })
    // nada a dizer (sem pool, sem aliados): lista vazia, com aviso
    const bare = recommend(input({ stats: null, traits }))
    expect(bare.status).toBe('no-stats')
    expect(bare.items).toEqual([])

    // com pool: os campeões da pool aparecem, marcados como dados insuficientes
    const pooled = recommend(input({ stats: null, traits, prefs: prefs({ pool: { [id('Alfa')]: 4, [id('Tango')]: 3 } }) }))
    expect(pooled.status).toBe('no-stats')
    expect(pooled.warnings.some((w) => w.kind === 'no-stats')).toBe(true)
    expect(ids(pooled)).toContain(id('Alfa'))
    expect(ids(pooled)).toContain(id('Tango')) // pool vale mesmo fora da rota típica
    expect(pooled.items.every((i) => i.quality === 'insufficient')).toBe(true)

    // com aliados físicos, quem traz dano mágico ganha sinal de composição mesmo sem estatísticas
    const t2 = makeTraits({ Alfa: { ad: 0, ap: 1, damageWeight: 1, positions: ['mid'] }, Hotel: { ad: 1, ap: 0, damageWeight: 1 }, India: { ad: 1, ap: 0, damageWeight: 1 }, Juliet: { ad: 1, ap: 0, damageWeight: 1 } })
    const draft = draftWith({ allies: { 1: ['Hotel', 'locked'], 2: ['India', 'locked'], 3: ['Juliet', 'locked'] } })
    const comp = recommend(input({ stats: null, traits: t2, draft }))
    expect(ids(comp)).toContain(id('Alfa'))
  })

  it('tabelas de matchup indisponíveis degradam para a base, com aviso', () => {
    const draft = draftWith({ enemies: { 0: ['Hotel', 'locked'] }, enemyPositions: { 0: 'mid' } })
    const r = recommend(input({ draft }))
    expect(r.items.length).toBe(5)
    expect(r.items[0]!.caveats.some((c) => c.kind === 'no-matchup-data')).toBe(true)
    expect(r.items[0]!.quality).toBe('partial')
  })

  it('campeão com baixa frequência na rota (off-role) recebe aviso', () => {
    const stats = makeStats({ mid: { Alfa: stat(9000, 0.53, 0.02) } })
    const r = recommend(input({ stats, prefs: prefs({ pool: { [id('Alfa')]: 3 } }) }))
    const alfa = r.items.find((i) => i.championId === id('Alfa'))
    expect(alfa?.caveats.some((c) => c.kind === 'off-role')).toBe(true)
  })
})

describe('matchup e posições ambíguas', () => {
  const matchups = (opp: string, play: number, win: number) => ({
    [`${id('Gama')}:mid`]: { fetchedAt: NOW, entries: { [id(opp)]: { play, win } } },
    [`${id('Beta')}:mid`]: { fetchedAt: NOW, entries: { [id(opp)]: { play: 2000, win: 1000 } } }
  })

  it('matchup favorável com posição conhecida eleva o campeão; explicação cita números reais', () => {
    const draft = draftWith({ enemies: { 0: ['Hotel', 'locked'] }, enemyPositions: { 0: 'mid' } })
    const stats = makeStats({ matchups: matchups('Hotel', 1000, 640) })
    const r = recommend(input({ draft, stats, prefs: prefs({ restrictToPool: true, pool: { [id('Gama')]: 2, [id('Beta')]: 2 } }) }))
    const gama = r.items.find((i) => i.championId === id('Gama'))!
    const f = gama.factors.find((x) => x.kind === 'matchup')!
    expect(f.pp).toBeGreaterThan(1)
    expect(f.text).toContain('Hotel')
    expect(f.text).toContain('64,0%')
    expect(f.text).toContain('1.000')
    expect(gama.reasons).toContain(f)
  })

  it('posição inimiga incerta reduz o peso do confronto e deixa a incerteza explícita', () => {
    const stats = makeStats({
      matchups: matchups('Hotel', 1000, 520),
      roleRates: { [id('Hotel')]: { mid: 0.5, top: 0.5 } }
    })
    const known = recommend(input({ draft: draftWith({ enemies: { 0: ['Hotel', 'locked'] }, enemyPositions: { 0: 'mid' } }), stats }))
    const unknown = recommend(input({ draft: draftWith({ enemies: { 0: ['Hotel', 'locked'] } }), stats }))
    const ppOf = (r: ReturnType<typeof recommend>) => r.items.find((i) => i.championId === id('Gama'))!.factors.find((x) => x.kind === 'matchup')
    const k = ppOf(known)
    const u = ppOf(unknown)
    expect(k).toBeDefined()
    expect(u).toBeDefined()
    expect(u!.pp).toBeLessThan(k!.pp * 0.6)
    expect(u!.pp).toBeGreaterThan(0)
    const gamaU = unknown.items.find((i) => i.championId === id('Gama'))!
    expect(gamaU.caveats.some((c) => c.kind === 'uncertain-opponent')).toBe(true)
    expect(unknown.laneOpponentDistribution[0]!.probability).toBeCloseTo(0.5, 1)
  })

  it('matchup com poucas partidas pesa menos que com muitas', () => {
    const draft = draftWith({ enemies: { 0: ['Hotel', 'locked'] }, enemyPositions: { 0: 'mid' } })
    const few = recommend(input({ draft, stats: makeStats({ matchups: matchups('Hotel', 40, 28) }) }))
    const many = recommend(input({ draft, stats: makeStats({ matchups: matchups('Hotel', 2000, 1400) }) }))
    const pp = (r: ReturnType<typeof recommend>) => r.items.find((i) => i.championId === id('Gama'))?.factors.find((x) => x.kind === 'matchup')?.pp ?? 0
    expect(pp(few)).toBeLessThan(pp(many) * 0.5)
  })

  it('não conta a força do campeão duas vezes: matchup igual à média do campeão dá efeito ~0', () => {
    const draft = draftWith({ enemies: { 0: ['Hotel', 'locked'] }, enemyPositions: { 0: 'mid' } })
    // Alfa tem 51% base; no confronto também ~51% => sem vantagem extra
    const stats = makeStats({ matchups: { [`${id('Alfa')}:mid`]: { fetchedAt: NOW, entries: { [id('Hotel')]: { play: 5000, win: 2550 } } } } })
    const r = recommend(input({ draft, stats }))
    const f = r.items.find((i) => i.championId === id('Alfa'))!.factors.find((x) => x.kind === 'matchup')!
    expect(Math.abs(f.pp)).toBeLessThan(0.6)
  })

  it('elo diferente do agregado das tabelas reduz peso e avisa', () => {
    const draft = draftWith({ enemies: { 0: ['Hotel', 'locked'] }, enemyPositions: { 0: 'mid' } })
    const m = matchups('Hotel', 1000, 520)
    const same = recommend(input({ draft, stats: makeStats({ matchups: m }) }))
    const mixed = recommend(input({ draft, stats: makeStats({ matchups: m, prov: { tier: 'GOLD' } }) }))
    const pp = (r: ReturnType<typeof recommend>) => r.items.find((i) => i.championId === id('Gama'))!.factors.find((x) => x.kind === 'matchup')!.pp
    expect(pp(mixed)).toBeCloseTo(pp(same) * CONFIG.mixedTierFactor, 5)
    expect(mixed.warnings.some((w) => w.kind === 'mixed-tier')).toBe(true)
  })
})

describe('sinergia', () => {
  it('usa só aliados confirmados com posição conhecida e líquida das taxas individuais', () => {
    const draft = draftWith({ allies: { 1: ['Hotel', 'locked'] }, allyPositions: { 1: 'support' } })
    const synergies = { [`${id('Delta')}:mid:support`]: { fetchedAt: NOW, entries: { [id('Hotel')]: { play: 900, win: 540 } } } }
    const r = recommend(input({ draft, stats: makeStats({ synergies }) }))
    const delta = r.items.find((i) => i.championId === id('Delta'))!
    const f = delta.factors.find((x) => x.kind === 'synergy')!
    expect(f.pp).toBeGreaterThan(1)
    expect(f.text).toContain('Hotel')
    expect(f.text).toContain('60,0%')
  })

  it('sem tabela de sinergia (falha da fonte) avisa e segue', () => {
    const draft = draftWith({ allies: { 1: ['Hotel', 'locked'] }, allyPositions: { 1: 'support' } })
    const r = recommend(input({ draft }))
    expect(r.items.length).toBe(5)
    expect(r.items.some((i) => i.caveats.some((c) => c.kind === 'no-synergy-data'))).toBe(true)
  })
})

describe('composição', () => {
  it('time todo físico favorece dano mágico e penaliza mais dano físico', () => {
    const traits = makeTraits({
      Alfa: { ad: 0, ap: 1, damageWeight: 1 },
      Beta: { ad: 1, ap: 0, damageWeight: 1 },
      Hotel: { ad: 1, ap: 0, damageWeight: 1 },
      India: { ad: 1, ap: 0, damageWeight: 1 },
      Juliet: { ad: 1, ap: 0, damageWeight: 1 }
    })
    const draft = draftWith({
      allies: { 1: ['Hotel', 'locked'], 2: ['India', 'locked'], 3: ['Juliet', 'locked'] }
    })
    const r = recommend(input({ draft, traits, prefs: prefs({ restrictToPool: true, pool: { [id('Alfa')]: 2, [id('Beta')]: 2 } }) }))
    const dmg = (name: string) => r.items.find((i) => i.championId === id(name))!.factors.find((f) => f.kind === 'damage')!.pp
    expect(dmg('Alfa')).toBeGreaterThan(0.5)
    expect(dmg('Beta')).toBeLessThan(-0.5)
  })

  it('sem aliados não há efeito de composição (nada a corrigir)', () => {
    const r = recommend(input())
    for (const i of r.items) expect(i.factors.filter((f) => f.group === 'composicao')).toHaveLength(0)
  })

  it('a soma dos fatores de composição é saturada pelo teto configurado', () => {
    const traits = makeTraits({
      Alfa: { frontline: 1, engage: 1, cc: 1, peel: 1, ad: 0, ap: 1, damageWeight: 1 },
      Hotel: { ad: 1, ap: 0, damageWeight: 1, ranged: false },
      India: { ad: 1, ap: 0, damageWeight: 1, ranged: false },
      Juliet: { ad: 1, ap: 0, damageWeight: 1, ranged: false, hypercarry: true },
      Kilo: { ad: 1, ap: 0, damageWeight: 1, ranged: false }
    })
    const draft = draftWith({ allies: { 1: ['Hotel', 'locked'], 2: ['India', 'locked'], 3: ['Juliet', 'locked'], 4: ['Kilo', 'locked'] } })
    const r = recommend(input({ draft, traits, prefs: prefs({ restrictToPool: true, pool: { [id('Alfa')]: 2 } }) }))
    const alfa = r.items[0]!
    const comp = alfa.factors.filter((f) => f.group === 'composicao').reduce((a, f) => a + f.pp, 0)
    expect(comp).toBeLessThanOrEqual(CONFIG.caps.compositionPp + 1e-9)
    expect(comp).toBeGreaterThan(1.5) // saturou perto do teto, não explodiu
  })
})

describe('procedência e explicações', () => {
  it('avisa patch diferente e dados antigos', () => {
    const r = recommend(input({ stats: makeStats({ prov: { patch: '16.20', fetchedAt: NOW - 40 * 3_600_000 } }) }))
    expect(r.warnings.map((w) => w.kind)).toEqual(expect.arrayContaining(['patch-mismatch', 'stale']))
  })

  it('pontuação é relativa (0–100), monótona no total e nunca descrita como probabilidade', () => {
    const r = recommend(input())
    for (const i of r.items) {
      expect(i.score).toBeGreaterThan(0)
      expect(i.score).toBeLessThan(100)
    }
    const hi = recommend(input({ stats: makeStats({ mid: { Alfa: stat(20000, 0.6) } }) })).items.find((i) => i.championId === id('Alfa'))!
    const lo = recommend(input({ stats: makeStats({ mid: { Alfa: stat(20000, 0.45) } }) }))
    expect(hi.score).toBeGreaterThan(70)
    expect(lo.items.find((i) => i.championId === id('Alfa'))).toBeUndefined()
  })

  it('motivos e risco refletem fatores realmente usados', () => {
    const draft = draftWith({ enemies: { 0: ['Hotel', 'locked'] }, enemyPositions: { 0: 'mid' } })
    const stats = makeStats({
      matchups: { [`${id('Alfa')}:mid`]: { fetchedAt: NOW, entries: { [id('Hotel')]: { play: 3000, win: 1350 } } } }
    })
    const r = recommend(input({ draft, stats, prefs: prefs({ restrictToPool: true, pool: { [id('Alfa')]: 3, [id('Beta')]: 2 } }) }))
    for (const item of r.items) {
      expect(item.reasons.length).toBeLessThanOrEqual(3)
      for (const reason of item.reasons) expect(item.factors).toContain(reason)
    }
    expect(r.items[0]!.reasons.length).toBeGreaterThanOrEqual(1)
    const alfa = r.items.find((i) => i.championId === id('Alfa'))!
    expect(alfa.risk?.kind).toBe('matchup') // 45% contra o oponente de rota é o principal risco
  })

  it('é determinístico', () => {
    const a = recommend(input())
    const b = recommend(input())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('padrão de preferências não restringe nada', () => {
    expect(DEFAULT_PREFERENCES.restrictToPool).toBe(false)
    expect(provenance().region).toBe('global')
  })
})
