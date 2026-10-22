import type { Catalog, GeneralBuildData, ItemInfo, ItemSet, MatchupGuideData, RunePage, SkillPlan } from './build-types'
import { archetypeOf, type Archetype } from './builds'
import { seededRng } from './rng'
import type { ChampionTraits } from './traits'
import type { Position } from './types'

/**
 * Builds FICTÍCIAS e determinísticas para o modo de demonstração e para testes. Usam o catálogo
 * real (ids/nomes/tags) para exercitar a interface sem rede; os números de amostra não significam nada.
 */

const COMPLETE_MIN_GOLD = 2200
const isComplete = (i: ItemInfo): boolean =>
  i.gold >= COMPLETE_MIN_GOLD && !i.tags.some((t) => ['Boots', 'Consumable', 'Trinket', 'Jungle', 'Lane', 'Vision'].includes(t))

/** Tags preferidas por arquétipo (para escolher itens plausíveis no demo). */
const WANT: Record<Archetype, string[]> = {
  mago: ['SpellDamage', 'AbilityHaste', 'MagicPenetration'],
  atirador: ['Damage', 'AttackSpeed', 'CriticalStrike'],
  assassino: ['Damage', 'ArmorPenetration', 'AbilityHaste'],
  lutador: ['Damage', 'Health', 'AbilityHaste'],
  tanque: ['Health', 'Armor', 'SpellBlock'],
  suporte: ['AbilityHaste', 'ManaRegen', 'Health'],
  generico: ['Damage', 'Health', 'AbilityHaste']
}

function pool(catalog: Catalog, arch: Archetype, rand: () => number): ItemInfo[] {
  const want = WANT[arch]
  return Object.values(catalog.items)
    .filter(isComplete)
    .map((i) => ({ i, s: want.filter((t) => i.tags.includes(t)).length + rand() * 0.9 }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i)
}

const sample = (rand: () => number, base: number): { play: number; win: number } => {
  const play = Math.round(base * (0.6 + rand()))
  return { play, win: Math.round(play * (0.47 + rand() * 0.1)) }
}

const itemSet = (ids: number[], catalog: Catalog, rand: () => number, base: number, pick = 0.2): ItemSet => ({
  ids,
  names: ids.map((id) => catalog.items[id]?.name ?? String(id)),
  ...sample(rand, base),
  pick
})

function bootsFor(catalog: Catalog, arch: Archetype): number[] {
  const boots = Object.values(catalog.items).filter((i) => i.tags.includes('Boots') && i.gold >= 900)
  const pref = arch === 'mago' ? ['Feiticeiro', 'Lucidez', 'Sapatos'] : arch === 'tanque' ? ['Aço', 'Mercúrio', 'Galvanizadas'] : ['Berserker', 'Rapidez', 'Mobilidade', 'Grevas']
  const hit = boots.find((b) => pref.some((p) => b.name.includes(p))) ?? boots[0]
  return hit ? [hit.id] : []
}

function runesFor(catalog: Catalog, arch: Archetype, rand: () => number): RunePage | null {
  const styles: Record<Archetype, [number, number]> = {
    mago: [8200, 8100],
    atirador: [8000, 8300],
    assassino: [8100, 8000],
    lutador: [8000, 8400],
    tanque: [8400, 8300],
    suporte: [8400, 8300],
    generico: [8000, 8400]
  }
  const [primary, secondary] = styles[arch]
  const all = Object.values(catalog.runes)
  const inStyle = (s: number): number[] => all.filter((r) => r.styleId === s).map((r) => r.id)
  const p = inStyle(primary)
  const s = inStyle(secondary)
  if (p.length < 4 || s.length < 2) return null
  const pick = (list: number[], n: number): number[] => {
    const copy = [...list]
    const out: number[] = []
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]!)
    return out
  }
  // runas de um estilo vêm do catálogo em ordem de linhas: usa as 4 primeiras como "keystone + 3 linhas" (fictício)
  return {
    primaryStyle: primary,
    primaryRunes: p.slice(0, 4),
    secondaryStyle: secondary,
    secondaryRunes: pick(s.slice(4), 2).length === 2 ? pick(s.slice(4), 2) : s.slice(0, 2),
    shards: [5008, 5008, 5011],
    ...sample(rand, 5000)
  }
}

const spellsFor = (catalog: Catalog, arch: Archetype, rand: () => number): ItemSet | null => {
  const second = arch === 'tanque' || arch === 'lutador' ? 12 : arch === 'suporte' ? 3 : arch === 'atirador' ? 7 : 14
  const ids = [4, second]
  if (!ids.every((id) => catalog.spells[id])) return null
  return itemSet(ids, catalog, rand, 9000, 0.7)
}

const SKILL_ORDERS = [
  ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E'],
  ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W'],
  ['W', 'Q', 'E', 'W', 'W', 'R', 'W', 'Q', 'W', 'Q', 'R', 'Q', 'Q', 'E', 'E']
]

export function demoGeneral(champion: number, traits: ChampionTraits, catalog: Catalog, patch: string | null): GeneralBuildData {
  const arch = archetypeOf(traits)
  const rand = seededRng(`bg${champion}`)
  const items = pool(catalog, arch, rand)
  const take = (from: number, n: number): number[] => items.slice(from, from + n).map((i) => i.id)
  const order = SKILL_ORDERS[champion % SKILL_ORDERS.length]!
  const skills: SkillPlan = { order, ...sample(rand, 7000) }
  return {
    damageType: traits.ap >= 0.7 ? 'AP' : traits.ad >= 0.7 ? 'AD' : 'BOTH',
    core: itemSet(take(0, 3), catalog, rand, 9000, 0.3),
    boots: itemSet(bootsFor(catalog, arch), catalog, rand, 12000, 0.6),
    starter: itemSet(arch === 'mago' ? [1056, 2003].filter((id) => catalog.items[id] || id === 2003) : [1055, 2003].filter((id) => catalog.items[id] || id === 2003), catalog, rand, 12000, 0.5),
    slot4: [3, 4, 5].map((o) => itemSet([take(o, 1)[0]!].filter(Boolean), catalog, rand, 4000, 0.25)).filter((s) => s.ids.length > 0),
    slot5: [6, 7, 8].map((o) => itemSet([take(o, 1)[0]!].filter(Boolean), catalog, rand, 3000, 0.25)).filter((s) => s.ids.length > 0),
    slot6: [9, 10].map((o) => itemSet([take(o, 1)[0]!].filter(Boolean), catalog, rand, 2000, 0.25)).filter((s) => s.ids.length > 0),
    spells: spellsFor(catalog, arch, rand),
    runes: runesFor(catalog, arch, rand),
    skills,
    skillPriority: ['Q', 'W', 'E'],
    patch,
    fetchedAt: 0
  }
}

export function demoGuide(champion: number, opponent: number, position: Position, traits: ChampionTraits, catalog: Catalog, patch: string | null): MatchupGuideData {
  const arch = archetypeOf(traits)
  const rand = seededRng(`mg${champion}-${opponent}-${position}`)
  const items = pool(catalog, arch, rand)
  const take = (from: number, n: number): number[] => items.slice(from, from + n).map((i) => i.id)
  const cores = [take(3, 3), take(1, 3), take(5, 3)].filter((c) => c.length === 3).map((ids, i) => itemSet(ids, catalog, rand, 90 - i * 25, 0.3))
  const singles: ItemSet[][] = [0, 1, 2, 3, 4, 5].map((d) => [itemSet(take(d + 2, 1), catalog, rand, 60, 0.4)].filter((s) => s.ids.length > 0))
  const play = Math.round(40 + rand() * 600)
  const wr = 0.44 + rand() * 0.12
  const side = (): 'me' | 'opponent' | 'even' => (rand() < 0.35 ? 'me' : rand() < 0.5 ? 'opponent' : 'even')
  return {
    opponent,
    position,
    cores,
    boots: [itemSet(bootsFor(catalog, arch), catalog, rand, 80, 0.7)],
    starters: [itemSet([1055, 2003].filter((id) => catalog.items[id] || id === 2003), catalog, rand, 80, 0.6)],
    singles,
    spells: [spellsFor(catalog, arch, rand)].filter((s): s is ItemSet => !!s),
    runes: [runesFor(catalog, arch, rand)].filter((r): r is RunePage => !!r),
    skills: [{ order: SKILL_ORDERS[(champion + opponent) % SKILL_ORDERS.length]!, ...sample(rand, 80) }],
    tipEn: 'Demo data: this tip is fictional. Trade when the opponent spends their key ability.',
    laneAdvantage: side(),
    soloKillAdvantage: side(),
    playStyle: rand() < 0.4 ? 'aggressive' : rand() < 0.5 ? 'defensive' : 'even',
    gameLengths: [
      { from: 0, rate: 0.47 + rand() * 0.08 },
      { from: 25, rate: 0.47 + rand() * 0.08 },
      { from: 35, rate: 0.47 + rand() * 0.08 }
    ],
    record: { play, win: Math.round(play * wr) },
    patch,
    fetchedAt: 0
  }
}
