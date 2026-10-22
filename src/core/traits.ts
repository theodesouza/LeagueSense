import type { Position } from './types'

/** Traços de composição de um campeão (0–1). Dados derivados + curadoria; ver docs/RECOMENDACAO.md. */
export interface ChampionTraits {
  /** Fração do dano físico / mágico (somam 1). */
  ad: number
  ap: number
  /** Quanto o dano do campeão pesa no time (suportes e tanques pesam pouco). */
  damageWeight: number
  ranged: boolean
  frontline: number
  engage: number
  cc: number
  peel: number
  disengage: number
  /** Ameaça de mergulho (assassinos/mergulhadores). */
  dive: number
  /** Cura/sustentação relevante (alvo de itens de Ferimento Grave). Curadoria manual. */
  sustain: number
  /** Precisa de proteção para escalar (atiradores etc.). */
  hypercarry: boolean
  /** Posições típicas — usadas só como alternativa quando não há estatísticas. */
  positions: Position[]
  source: 'derived' | 'curated' | 'fallback'
}

export type TraitsTable = Record<number, ChampionTraits>

export interface TraitSource {
  adaptive: string
  attackType: string
  roles: string[]
  ratings: { damage: number; toughness: number; control: number; mobility: number; utility: number }
  positions: string[]
}

const MERAKI_POSITION: Record<string, Position> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'mid',
  BOTTOM: 'adc',
  SUPPORT: 'support'
}

const has = (roles: string[], ...wanted: string[]): boolean => wanted.some((w) => roles.includes(w))
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Deriva traços a partir de funções e atributos (Meraki Analytics). */
export function deriveTraits(src: TraitSource): ChampionTraits {
  const { roles, ratings } = src
  const ap = src.adaptive === 'MAGIC_DAMAGE' ? 1 : src.adaptive === 'PHYSICAL_DAMAGE' ? 0 : 0.5
  const melee = src.attackType === 'MELEE'
  const damageWeight = ({ 1: 0.25, 2: 0.65, 3: 1 } as Record<number, number>)[ratings.damage] ?? 0.65

  let frontline = 0
  if (has(roles, 'VANGUARD', 'WARDEN')) frontline = 1
  else if (has(roles, 'TANK')) frontline = ratings.toughness >= 3 ? 1 : 0.7
  else if (has(roles, 'JUGGERNAUT')) frontline = 0.6
  else frontline = ratings.toughness >= 3 ? 0.8 : ratings.toughness === 2 ? 0.35 : 0
  if (has(roles, 'SUPPORT') && !has(roles, 'VANGUARD', 'WARDEN')) frontline = Math.min(frontline, 0.5)

  let engage = 0
  if (has(roles, 'VANGUARD')) engage = 1
  else if (has(roles, 'CATCHER', 'DIVER')) engage = 0.7
  else if (ratings.mobility >= 3 && melee && ratings.control >= 2) engage = 0.5
  else if (has(roles, 'JUGGERNAUT')) engage = 0.2

  let peel = 0
  if (has(roles, 'ENCHANTER')) peel = 1
  else if (has(roles, 'WARDEN')) peel = 0.9
  else if (ratings.utility >= 3 && has(roles, 'SUPPORT')) peel = 0.7
  else if (ratings.utility >= 3) peel = 0.3

  let disengage = 0
  if (has(roles, 'WARDEN')) disengage = 0.7
  else if (has(roles, 'ENCHANTER')) disengage = 0.5
  else if (ratings.control >= 3 && !melee) disengage = 0.4

  let dive = 0
  if (has(roles, 'ASSASSIN')) dive = 1
  else if (has(roles, 'DIVER')) dive = 0.8
  else if (has(roles, 'SKIRMISHER')) dive = 0.5
  if (ratings.mobility >= 3 && melee) dive = Math.max(dive, 0.6)

  const positions = [...new Set(src.positions.map((p) => MERAKI_POSITION[p]).filter(Boolean) as Position[])]

  return {
    ad: 1 - ap,
    ap,
    damageWeight,
    ranged: !melee,
    frontline: clamp01(frontline),
    engage: clamp01(engage),
    cc: clamp01((ratings.control - 1) / 2),
    peel: clamp01(peel),
    disengage: clamp01(disengage),
    dive: clamp01(dive),
    sustain: 0,
    hypercarry: has(roles, 'MARKSMAN') && !(positions.length === 1 && positions[0] === 'support'),
    positions,
    source: 'derived'
  }
}

/**
 * Traços grosseiros a partir das tags do Data Dragon, para campeões que ainda não estão na
 * tabela embutida (lançamentos recentes). Deliberadamente conservador: quase tudo neutro.
 */
export function fallbackTraits(tags: string[]): ChampionTraits {
  const t = new Set(tags)
  const tank = t.has('Tank')
  const mage = t.has('Mage')
  const support = t.has('Support')
  const marksman = t.has('Marksman')
  return {
    ad: mage ? 0.2 : 0.8,
    ap: mage ? 0.8 : 0.2,
    damageWeight: tank || support ? 0.4 : 0.8,
    ranged: marksman || mage || support,
    frontline: tank ? 0.8 : t.has('Fighter') ? 0.3 : 0,
    engage: tank ? 0.4 : 0,
    cc: tank || support ? 0.5 : 0.25,
    peel: support && !tank ? 0.5 : 0,
    disengage: 0,
    dive: t.has('Assassin') ? 0.8 : 0,
    sustain: 0,
    hypercarry: marksman,
    positions: [],
    source: 'fallback'
  }
}

export function traitsFor(table: TraitsTable, id: number, tags: string[] | undefined): ChampionTraits {
  const t = table[id]
  return t ? { ...t, sustain: t.sustain ?? 0 } : fallbackTraits(tags ?? [])
}
