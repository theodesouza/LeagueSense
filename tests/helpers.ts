import { emptyDraft, setMe, setSlotChampion } from '@core/draft'
import type { ChampionTraits, TraitsTable } from '@core/traits'
import {
  DEFAULT_PREFERENCES,
  type BaseStat,
  type ChampionInfo,
  type Draft,
  type EloTier,
  type Position,
  type Preferences,
  type Provenance,
  type StatsSnapshot
} from '@core/types'
import type { EngineInput } from '@core/engine'

export const NOW = Date.UTC(2026, 9, 22, 18, 0, 0)

/** Mundo sintético: ids 1..N com nomes simples. Rota "mid" tem vários candidatos. */
export const NAMES = [
  'Alfa', 'Beta', 'Gama', 'Delta', 'Eco', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet',
  'Kilo', 'Lima', 'Mike', 'Nov', 'Oscar', 'Papa', 'Quebec', 'Romeu', 'Sierra', 'Tango'
]
export const roster = new Map<number, ChampionInfo>(
  NAMES.map((n, i) => [i + 1, { id: i + 1, key: n, name: n, nameEn: n, tags: ['Mage'] }])
)
export const id = (name: string): number => NAMES.indexOf(name) + 1

export const neutralTraits = (over: Partial<ChampionTraits> = {}): ChampionTraits => ({
  ad: 0.5,
  ap: 0.5,
  damageWeight: 0.65,
  ranged: true,
  frontline: 0,
  engage: 0,
  cc: 0.25,
  peel: 0,
  disengage: 0,
  dive: 0,
  sustain: 0,
  hypercarry: false,
  positions: ['mid'],
  source: 'derived',
  ...over
})

export function makeTraits(over: Record<string, Partial<ChampionTraits>> = {}): TraitsTable {
  const t: TraitsTable = {}
  for (const [i, n] of NAMES.entries()) t[i + 1] = neutralTraits(over[n])
  return t
}

export function provenance(over: Partial<Provenance> = {}): Provenance {
  return {
    source: 'opgg-mcp',
    patch: '16.21',
    currentPatch: '16.21',
    tier: 'EMERALD_PLUS' as EloTier,
    tableTier: 'EMERALD_PLUS' as EloTier,
    region: 'global',
    queue: 'ranked-solo-duo',
    fetchedAt: NOW - 3_600_000,
    fromCache: false,
    ...over
  }
}

export const stat = (play: number, wr: number, roleRate = 0.9): BaseStat => ({
  play,
  win: Math.round(play * wr),
  roleRate,
  pickRate: 0.05,
  banRate: 0.02
})

/** Estatísticas: todos os 12 primeiros campeões em "mid" com WR variados. */
export function makeStats(over: {
  mid?: Record<string, BaseStat>
  matchups?: StatsSnapshot['matchups']
  synergies?: StatsSnapshot['synergies']
  prov?: Partial<Provenance>
  roleRates?: StatsSnapshot['roleRates']
} = {}): StatsSnapshot {
  const mid: Record<number, BaseStat> = {}
  const defaults: Record<string, BaseStat> = {
    Alfa: stat(20000, 0.51),
    Beta: stat(18000, 0.5),
    Gama: stat(15000, 0.49),
    Delta: stat(12000, 0.52),
    Eco: stat(9000, 0.505),
    Foxtrot: stat(8000, 0.495),
    Golf: stat(7000, 0.5),
    Hotel: stat(6000, 0.5)
  }
  for (const [n, s] of Object.entries({ ...defaults, ...(over.mid ?? {}) })) mid[id(n)] = s
  const roleRates: StatsSnapshot['roleRates'] = {}
  for (const k of Object.keys(mid)) roleRates[Number(k)] = { mid: 0.9 }
  Object.assign(roleRates, over.roleRates ?? {})
  return {
    provenance: provenance(over.prov),
    base: { mid },
    baseDefault: { mid },
    roleRates,
    matchups: over.matchups ?? {},
    synergies: over.synergies ?? {}
  }
}

export function draftWith(parts: {
  allies?: Record<number, [string, 'locked' | 'hover']>
  enemies?: Record<number, [string, 'locked' | 'hover']>
  bansAllies?: string[]
  bansEnemies?: string[]
  mePick?: number
  allyPositions?: Record<number, Position>
  enemyPositions?: Record<number, Position>
}): Draft {
  let d = emptyDraft('t-1', 'manual', 'picking')
  d = setMe(d, parts.mePick ?? 0)
  for (const [i, [n, st]] of Object.entries(parts.allies ?? {})) d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: Number(i) }, id(n), st)
  for (const [i, [n, st]] of Object.entries(parts.enemies ?? {})) d = setSlotChampion(d, { kind: 'pick', side: 'enemy', index: Number(i) }, id(n), st)
  ;(parts.bansAllies ?? []).forEach((n, i) => (d = setSlotChampion(d, { kind: 'ban', side: 'ally', index: i }, id(n))))
  ;(parts.bansEnemies ?? []).forEach((n, i) => (d = setSlotChampion(d, { kind: 'ban', side: 'enemy', index: i }, id(n))))
  const clone: Draft = { ...d, allies: d.allies.map((s) => ({ ...s })), enemies: d.enemies.map((s) => ({ ...s })) }
  for (const [i, p] of Object.entries(parts.allyPositions ?? {})) {
    clone.allies[Number(i)]!.position = p
    clone.allies[Number(i)]!.positionSource = 'assigned'
  }
  for (const [i, p] of Object.entries(parts.enemyPositions ?? {})) {
    clone.enemies[Number(i)]!.position = p
    clone.enemies[Number(i)]!.positionSource = 'assigned'
  }
  return clone
}

export function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    draft: draftWith({}),
    position: 'mid',
    stats: makeStats(),
    roster,
    traits: makeTraits(),
    prefs: { ...DEFAULT_PREFERENCES },
    player: null,
    now: NOW,
    ...over
  }
}

export const prefs = (over: Partial<Preferences>): Preferences => ({ ...DEFAULT_PREFERENCES, ...over })
