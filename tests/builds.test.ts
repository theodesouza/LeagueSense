import { describe, expect, it } from 'vitest'
import { archetypeOf, planGame } from '@core/builds'
import { explainTop } from '@core/explain-rank'
import { matchupAdvice } from '@core/matchup-advice'
import type { TeamMember } from '@core/composition'
import type { BuildBundle, Catalog, GeneralBuildData, ItemInfo, ItemSet, MatchupGuideData, RunePage } from '@core/build-types'
import type { Factor, Recommendation } from '@core/types'
import { id, neutralTraits, NAMES } from './helpers'

const item = (id: number, name: string, tags: string[], gold = 3000, antiHeal = false): ItemInfo => ({ id, name, plain: `${name} (descrição)`, tags, gold, antiHeal })
const ITEMS: ItemInfo[] = [
  item(3118, 'Malevolência', ['SpellDamage', 'Mana']),
  item(4645, 'Chama Sombria', ['SpellDamage']),
  item(3157, 'Zhonya', ['Armor', 'SpellDamage', 'Active']),
  item(3089, 'Rabadon', ['SpellDamage']),
  item(3135, 'Cajado do Vazio', ['SpellDamage', 'MagicPenetration']),
  item(3102, 'Véu da Banshee', ['SpellBlock', 'SpellDamage']),
  item(3165, 'Morellonomicon', ['Health', 'SpellDamage'], 2850, true),
  item(3100, 'Lich Bane', ['SpellDamage']),
  item(3041, 'Mejai', ['SpellDamage']),
  item(3020, 'Sapatos do Feiticeiro', ['Boots', 'MagicPenetration'], 1100),
  item(3111, 'Passos de Mercúrio', ['Boots', 'SpellBlock', 'Tenacity'], 1250),
  item(3158, 'Botas da Lucidez', ['Boots', 'AbilityHaste'], 950),
  item(6653, 'Serrilha', ['Armor', 'Health']),
  item(1056, 'Anel de Doran', ['Health', 'Lane', 'SpellDamage'], 400),
  item(2003, 'Poção de Vida', ['Consumable'], 50)
]
const catalog: Catalog = { version: '16.21.1', items: Object.fromEntries(ITEMS.map((i) => [i.id, i])), runes: {}, styles: {}, spells: {} }

const set = (ids: number[], play: number, win: number, pick = 0.2): ItemSet => ({ ids, names: ids.map((i) => `Item ${i}`), play, win, pick })
const page: RunePage = { primaryStyle: 8100, primaryRunes: [8112, 8139, 8140, 8106], secondaryStyle: 8200, secondaryRunes: [8210, 8226], shards: [5005, 5008, 5001], play: 11016, win: 5526 }

const general: GeneralBuildData = {
  damageType: 'AP',
  core: set([3118, 4645, 3157], 1842, 971, 0.13),
  boots: set([3020], 13320, 6870, 0.58),
  starter: set([1056, 2003, 2003], 23170, 11804, 0.99),
  slot4: [set([3089], 1856, 1043, 0.32), set([3157], 1386, 819, 0.24), set([3041], 471, 373, 0.08)],
  slot5: [set([3089], 286, 182, 0.2), set([3135], 267, 142, 0.19), set([3157], 233, 135, 0.16)],
  slot6: [set([3102], 4, 2, 0.19), set([3157], 3, 1, 0.14)],
  spells: set([4, 14], 16230, 8350, 0.69),
  runes: page,
  skills: { order: ['W', 'Q', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E'], play: 9086, win: 5212 },
  skillPriority: ['Q', 'W', 'E'],
  patch: '16.21',
  fetchedAt: 1
}
const guide = (over: Partial<MatchupGuideData> = {}): MatchupGuideData => ({
  opponent: 157,
  position: 'mid',
  cores: [set([3118, 4645, 3157], 63, 42, 0.2), set([3118, 3100, 3089], 40, 25, 0.12), set([4645, 3100, 3089], 30, 20, 0.1), set([3118, 3041, 3165], 6, 5, 0.02)],
  boots: [set([3020], 615, 284, 0.62), set([3158], 333, 178, 0.33), set([3111], 40, 22, 0.04)],
  starters: [set([1056, 2003, 2003], 1001, 488, 0.98)],
  singles: [[], [], [], [set([3089], 81, 49, 0.37), set([3157], 44, 29, 0.2), set([3135], 22, 11, 0.1), set([3165], 18, 9, 0.08), set([3102], 12, 7, 0.05)], [set([3135], 30, 18, 0.2), set([3102], 20, 12, 0.1)], [set([3157], 9, 5, 0.1)]],
  spells: [set([4, 14], 717, 354, 0.7), set([4, 12], 263, 125, 0.26), set([1, 4], 50, 27, 0.04)],
  runes: [{ ...page, play: 502, win: 236 }],
  skills: [{ order: general.skills!.order, play: 415, win: 232 }],
  tipEn: 'Wind Wall can block your skillshots.',
  laneAdvantage: 'even',
  soloKillAdvantage: 'opponent',
  playStyle: 'defensive',
  gameLengths: [{ from: 0, rate: 0.49 }, { from: 25, rate: 0.52 }, { from: 30, rate: 0.51 }, { from: 35, rate: 0.5 }, { from: 40, rate: 0.49 }],
  record: { play: 776, win: 378 },
  patch: '16.21',
  fetchedAt: 1,
  ...over
})
const bundle = (over: Partial<BuildBundle> = {}): BuildBundle => ({
  key: 'k',
  champion: id('Alfa'),
  position: 'mid',
  opponent: id('Beta'),
  general,
  guide: guide(),
  opponentTips: ['Tempestade de Aço é muito estreita. Desvie lateralmente.', 'O momento mais fraco é logo após o tornado.'],
  catalog,
  provenance: { source: 'opgg-mcp', patch: '16.21', currentPatch: '16.21', tier: 'EMERALD_PLUS', guideTier: 'EMERALD_PLUS', fetchedAt: 1, fromCache: false },
  problems: [],
  ...over
})

const member = (name: string, over: Parameters<typeof neutralTraits>[0] = {}, weight = 1): TeamMember => ({ champion: id(name), weight, traits: neutralTraits(over) })
const nameOf = (i: number): string => NAMES[i - 1] ?? `#${i}`
const mage = neutralTraits({ ad: 0, ap: 1, damageWeight: 1, ranged: true, frontline: 0, dive: 0.5 })

const plan = (over: { enemies?: TeamMember[]; allies?: TeamMember[]; bundle?: BuildBundle; opponent?: { champion: number; probability: number } | null } = {}) =>
  planGame({
    champion: id('Alfa'),
    position: 'mid',
    nameOf,
    traitsOf: (i) => (i === id('Alfa') ? mage : neutralTraits()),
    allies: over.allies ?? [],
    enemies: over.enemies ?? [],
    bundle: over.bundle ?? bundle(),
    opponent: over.opponent === undefined ? { champion: id('Beta'), probability: 1 } : over.opponent
  })

const mainItems = (b: { items: { role: string; id: number }[] }): number[] => b.items.filter((i) => i.role === 'principal').map((i) => i.id)
const idsOf = (b: { items: { role: string; id: number }[] }, role: string): number[] => b.items.filter((i) => i.role === role).map((i) => i.id)

describe('planGame — builds', () => {
  it('gera 3 builds distintas, todas com itens reais dos dados', () => {
    const p = plan()
    expect(p.builds.map((b) => b.id)).toEqual(['meta', 'confronto', 'adaptada'])
    const sets = p.builds.map((b) => mainItems(b).join())
    expect(new Set(sets).size).toBe(3)
    const known = new Set([...ITEMS.map((i) => i.id)])
    for (const b of p.builds) for (const it of b.items) expect(known.has(it.id)).toBe(true)
    for (const b of p.builds) {
      expect(idsOf(b, 'principal')).toHaveLength(3)
      expect(idsOf(b, 'botas')).toHaveLength(1)
      expect(idsOf(b, 'situacional').length).toBeGreaterThanOrEqual(1)
      expect(new Set(b.items.filter((i) => i.role !== 'inicial').map((i) => i.id)).size).toBe(b.items.filter((i) => i.role !== 'inicial').length) // sem itens repetidos
    }
  })

  it('build 1 usa o núcleo mais jogado; build 2 usa o de melhor taxa no confronto com amostra mínima', () => {
    const p = plan()
    expect(mainItems(p.builds[0]!)).toEqual([3118, 4645, 3157])
    // o núcleo de 6 partidas (5 vitórias) NÃO é escolhido: amostra pequena demais
    expect(mainItems(p.builds[1]!)).not.toEqual([3118, 3041, 3165])
    expect(p.builds[1]!.caveats.join(' ')).toMatch(/específicos do confronto/)
  })

  it('item raro de "bola de neve" (taxa de vitória enorme, pouca escolha) não passa na frente dos populares', () => {
    const p = plan()
    const slots = idsOf(p.builds[0]!, 'situacional')
    expect(slots[0]).toBe(3089) // Rabadon: o mais escolhido
    expect(slots.indexOf(3041)).toBeGreaterThan(slots.indexOf(3089)) // Mejai (79 % em 471 partidas) fica atrás ou fora
  })

  it('inimigos com muito dano físico levam itens de armadura e o motivo cita o fato usado', () => {
    const phys = (n: string) => member(n, { ad: 1, ap: 0, damageWeight: 1 })
    const p = plan({ enemies: [phys('Beta'), phys('Gama'), phys('Delta'), phys('Eco')] })
    const b = p.builds[2]!
    const withArmor = b.items.filter((i) => ITEMS.find((x) => x.id === i.id)!.tags.includes('Armor'))
    expect(withArmor.length).toBeGreaterThan(0)
    expect(b.adaptations.join(' ')).toMatch(/100% do dano inimigo é físico/)
    // sem esse dado a adaptação não existe
    const neutral = plan({ enemies: [] }).builds[2]!
    expect(neutral.adaptations.join(' ')).not.toMatch(/dano inimigo/)
  })

  it('muito dano mágico inimigo favorece resistência mágica (botas de Mercúrio) e Tenacidade com muito CC', () => {
    const ap = (n: string) => member(n, { ad: 0, ap: 1, damageWeight: 1, cc: 1 })
    const p = plan({ enemies: [ap('Beta'), ap('Gama'), ap('Delta'), ap('Eco')] })
    const b = p.builds[2]!
    expect(idsOf(b, 'botas')).toEqual([3111])
    expect(b.adaptations.join(' ')).toMatch(/Tenacidade/)
  })

  it('inimigos tanques favorecem penetração do tipo certo (mágica para mago)', () => {
    const tank = (n: string) => member(n, { frontline: 1, damageWeight: 0.25 })
    const p = plan({ enemies: [tank('Beta'), tank('Gama'), tank('Delta')] })
    const b = p.builds[2]!
    expect(b.items.some((i) => i.id === 3135 || i.id === 3020)).toBe(true)
    expect(b.adaptations.join(' ')).toMatch(/Penetração/)
  })

  it('inimigos que se curam levam item de redução de cura', () => {
    const p = plan({ enemies: [member('Beta', { sustain: 1 }), member('Gama', { sustain: 0.8 })] })
    expect(p.builds.some((b) => b.items.some((i) => i.id === 3165))).toBe(true)
    expect(p.builds.flatMap((b) => b.adaptations).join(' ')).toMatch(/Redução de cura/)
  })

  it('feitiços: Purificar quando há muito CC inimigo e a opção existe nos dados', () => {
    const cc = (n: string) => member(n, { cc: 1 })
    const p = plan({ enemies: [cc('Beta'), cc('Gama'), cc('Delta'), cc('Eco')] })
    expect(p.builds[2]!.spells?.ids).toContain(1)
    expect(p.builds[0]!.spells?.ids).toEqual([4, 14])
  })

  it('degrada com graça: sem o guia do confronto → 2 builds + aviso; sem catálogo → nomes de recuo e aviso', () => {
    const noGuide = plan({ bundle: bundle({ guide: null }) })
    expect(noGuide.builds.map((b) => b.id)).toEqual(['meta', 'adaptada'])
    expect(noGuide.warnings.join(' ')).toMatch(/Menos de 3 builds/)
    const noCat = plan({ bundle: bundle({ catalog: null }) })
    expect(noCat.warnings.join(' ')).toMatch(/Catálogo/)
    expect(noCat.builds[0]!.items[0]!.name).toMatch(/Item|Item 1056/)
    expect(plan({ bundle: bundle({ general: null, guide: null }) }).builds).toEqual([])
  })

  it('é determinístico', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()))
  })
})

describe('planGame — objetivo e comportamento', () => {
  const texts = (b: { objective: string; behavior: { items: { text: string; because?: string }[] }[] }) => [b.objective, ...b.behavior.flatMap((g) => g.items.flatMap((i) => [i.text, i.because ?? '']))].join(' | ')

  it('sempre traz objetivo e três fases; o arquétipo vem dos traços', () => {
    const b = plan().builds[0]!
    expect(b.archetype).toBe('Mago')
    expect(b.objective.length).toBeGreaterThan(40)
    expect(b.behavior.map((g) => g.phase)).toEqual(['Fase de rota', 'Meio de jogo', 'Lutas de equipe'])
  })

  it('só cita mergulho inimigo quando existe (e com os nomes certos)', () => {
    const none = texts(plan().builds[0]!)
    expect(none).not.toMatch(/inimigos com mergulho/)
    const dive = (n: string) => member(n, { dive: 1 })
    const t = texts(plan({ enemies: [dive('Beta'), dive('Gama')] }).builds[0]!)
    expect(t).toMatch(/inimigos com mergulho \(Beta, Gama\)/)
  })

  it('aliados sem frente e com engajamento mudam as instruções', () => {
    const allies = [member('Delta', { engage: 1, frontline: 0.2 }), member('Eco', { frontline: 0 }), member('Foxtrot', { frontline: 0.1 })]
    const t = texts(plan({ allies }).builds[0]!)
    expect(t).toMatch(/pouca linha de frente/)
    expect(t).toMatch(/engajamento de Delta/)
  })

  it('o confronto entra na rota: desfavorável pede cautela, favorável pede pressão', () => {
    const bad = texts(plan({ bundle: bundle({ guide: guide({ record: { play: 600, win: 250 } }) }) }).builds[0]!)
    expect(bad).toMatch(/Confronto difícil/)
    const good = texts(plan({ bundle: bundle({ guide: guide({ record: { play: 600, win: 340 } }) }) }).builds[0]!)
    expect(good).toMatch(/Confronto favorável/)
    expect(good).toMatch(/taxa de vitória 57%/)
  })

  it('build do confronto e adaptada declaram seu propósito no objetivo', () => {
    const p = plan()
    expect(p.builds[1]!.objective).toMatch(/Beta/)
    expect(p.builds[2]!.objective).toMatch(/ajustada à composição/)
  })
})

describe('arquétipo', () => {
  const tf = neutralTraits({ ad: 0, ap: 1, damageWeight: 1, ranged: true, hypercarry: true, cc: 0.5 })
  it('a função principal do Data Dragon manda; hypercarry de dano mágico é mago, não atirador', () => {
    expect(archetypeOf(tf, ['Mage', 'Marksman'])).toBe('mago')
    expect(archetypeOf(tf)).toBe('mago') // sem tags: atirador exige dano físico
    expect(archetypeOf(neutralTraits({ ad: 1, ap: 0, damageWeight: 1, ranged: true, hypercarry: true }))).toBe('atirador')
    expect(archetypeOf(neutralTraits({ ad: 1, damageWeight: 1, ranged: false, dive: 1 }), ['Fighter', 'Assassin'])).toBe('lutador')
    expect(archetypeOf(neutralTraits({ ad: 1, damageWeight: 1, ranged: false, dive: 1 }), ['Assassin'])).toBe('assassino')
    expect(archetypeOf(neutralTraits(), ['Support', 'Tank'])).toBe('suporte')
  })
  it('tag desconhecida cai para os traços', () => {
    expect(archetypeOf(neutralTraits({ ad: 0, ap: 1, ranged: true }), ['Outra'])).toBe('mago')
  })
})

describe('matchupAdvice', () => {
  const base = { me: id('Alfa'), opponent: id('Beta'), probability: 1, nameOf, meTraits: mage, oppTraits: neutralTraits({ ranged: false }), record: { play: 776, win: 378 }, guide: guide(), riotTips: ['Dica oficial 1', 'Dica oficial 2', 'Dica 3', 'Dica 4'] }

  it('veredito por taxa ajustada; amostra pequena não dá veredito', () => {
    expect(matchupAdvice({ ...base, record: { play: 600, win: 340 } }).verdict).toBe('favoravel')
    expect(matchupAdvice({ ...base, record: { play: 600, win: 250 } }).verdict).toBe('desfavoravel')
    expect(matchupAdvice({ ...base, record: { play: 600, win: 300 } }).verdict).toBe('equilibrado')
    expect(matchupAdvice({ ...base, record: { play: 20, win: 18 } }).verdict).toBe('sem-dados')
    expect(matchupAdvice({ ...base, record: null }).verdict).toBe('sem-dados')
  })

  it('cada linha diz a origem; dicas da Riot (pt-BR) limitadas a 3; dica do OP.GG marcada como inglês', () => {
    const a = matchupAdvice(base)
    expect(a.lines.every((l) => l.source.length > 3)).toBe(true)
    expect(a.lines.filter((l) => l.kind === 'riot')).toHaveLength(3)
    expect(a.lines.find((l) => l.kind === 'opgg')!.source).toMatch(/inglês/)
    expect(a.lines.some((l) => l.kind === 'heuristica' && /distância/.test(l.text))).toBe(true) // mago à distância vs corpo a corpo
  })

  it('oponente incerto deixa a incerteza explícita', () => {
    const a = matchupAdvice({ ...base, probability: 0.62 })
    expect(a.uncertainty).toMatch(/62%/)
    expect(a.headline).toMatch(/provável oponente de rota, 62%/)
    expect(matchupAdvice(base).uncertainty).toBeNull()
  })
})

describe('explainTop', () => {
  const f = (kind: Factor['kind'], pp: number): Factor => ({ kind, group: 'estatistica', pp, text: `${kind} ${pp}` })
  const rec = (n: number, score: number, factors: Factor[]): Recommendation => ({
    championId: n, score, totalPp: factors.reduce((a, x) => a + x.pp, 0), factors, reasons: [], risk: null, caveats: [], quality: 'ok',
    sample: { base: 1000, lane: null }, baseWinRate: 0.5, laneOpponents: [], familiarity: { level: null, source: 'nenhuma' }
  })

  it('compara o 1º ao 2º fator a fator e ordena as vantagens', () => {
    const e = explainTop([rec(1, 80, [f('base', 2), f('matchup', 3.1)]), rec(2, 70, [f('base', 2.4), f('matchup', 0.4), f('synergy', 1.2)])], nameOf)!
    expect(e.tie).toBe(false)
    expect(e.advantages[0]!.kind).toBe('matchup')
    expect(e.tradeoffs.map((t) => t.kind)).toContain('synergy')
    expect(e.headline).toMatch(/Alfa está em 1º/)
    expect(e.headline).toMatch(/confronto de rota/)
  })

  it('empate prático é dito como tal (histerese)', () => {
    const e = explainTop([rec(1, 70.2, [f('base', 2)]), rec(2, 70, [f('base', 2)])], nameOf)!
    expect(e.tie).toBe(true)
    expect(e.headline).toMatch(/praticamente empatados/)
  })

  it('opção única e lista vazia', () => {
    expect(explainTop([rec(1, 70, [])], nameOf)!.headline).toMatch(/única opção/)
    expect(explainTop([], nameOf)).toBeNull()
  })
})
