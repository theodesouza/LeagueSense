import type { Position } from './types'

/* ---------------------------- catálogo (Data Dragon) ---------------------------- */

export interface ItemInfo {
  id: number
  name: string
  /** Descrição curta (pt-BR) do Data Dragon. */
  plain: string
  tags: string[]
  /** Custo total em ouro. */
  gold: number
  /** Aplica Ferimento Grave (reduz cura). */
  antiHeal: boolean
}
export interface RuneInfo {
  id: number
  key: string
  name: string
  /** Caminho do ícone no Data Dragon (ex.: perk-images/Styles/Domination/Electrocute/Electrocute.png). */
  icon: string
  styleId: number
  short: string
}
export interface StyleInfo {
  id: number
  name: string
  icon: string
}
export interface SpellInfo {
  id: number
  /** Id de imagem (ex.: SummonerFlash). */
  key: string
  name: string
}
export interface Catalog {
  version: string
  items: Record<number, ItemInfo>
  runes: Record<number, RuneInfo>
  styles: Record<number, StyleInfo>
  spells: Record<number, SpellInfo>
}

/* ---------------------------- dados do OP.GG ---------------------------- */

/** Opção de itens/feitiços/botas: ids + amostra. `names` (inglês) serve de recuo se o catálogo não tiver o id. */
export interface ItemSet {
  ids: number[]
  names: string[]
  play: number
  win: number
  /** Taxa de escolha (0–1) dentro da lista de origem. */
  pick: number
}
export interface RunePage {
  primaryStyle: number
  primaryRunes: number[]
  secondaryStyle: number
  secondaryRunes: number[]
  shards: number[]
  play: number
  win: number
}
export interface SkillPlan {
  /** Ordem de pontos nos 15 primeiros níveis (Q/W/E/R). */
  order: string[]
  play: number
  win: number
}

export interface GeneralBuildData {
  damageType: 'AD' | 'AP' | 'BOTH' | null
  core: ItemSet | null
  boots: ItemSet | null
  starter: ItemSet | null
  slot4: ItemSet[]
  slot5: ItemSet[]
  slot6: ItemSet[]
  spells: ItemSet | null
  runes: RunePage | null
  skills: SkillPlan | null
  /** Prioridade de habilidades, ex.: ["Q","W","E"]. */
  skillPriority: string[]
  patch: string | null
  fetchedAt: number
}

export type LaneSide = 'me' | 'opponent' | 'even'

export interface MatchupGuideData {
  opponent: number
  position: Position
  cores: ItemSet[]
  boots: ItemSet[]
  starters: ItemSet[]
  /** Itens individuais por ordem de compra (índice 0 = 1º item … 5 = 6º). */
  singles: ItemSet[][]
  spells: ItemSet[]
  runes: RunePage[]
  skills: SkillPlan[]
  /** Dica do OP.GG (em inglês). */
  tipEn: string | null
  laneAdvantage: LaneSide | null
  soloKillAdvantage: LaneSide | null
  playStyle: 'aggressive' | 'defensive' | 'even' | null
  /** Taxa de vitória por faixa de duração: `from` = minuto inicial da faixa. */
  gameLengths: { from: number; rate: number }[]
  /** Partidas e vitórias do meu campeão contra este oponente. */
  record: { play: number; win: number } | null
  patch: string | null
  fetchedAt: number
}

export interface BuildBundle {
  key: string
  champion: number
  position: Position
  opponent: number | null
  general: GeneralBuildData | null
  guide: MatchupGuideData | null
  /** Dicas oficiais da Riot (pt-BR) para enfrentar o oponente. */
  opponentTips: string[]
  catalog: Catalog | null
  provenance: {
    source: 'opgg-mcp' | 'demo'
    patch: string | null
    currentPatch: string | null
    tier: string
    /** Elo do guia de confronto (o provedor não filtra; inferido como Emerald+). */
    guideTier: string
    fetchedAt: number | null
    fromCache: boolean
  }
  /** Problemas parciais (texto para o usuário). */
  problems: { message: string; action?: string }[]
}

/* ---------------------------- plano gerado ---------------------------- */

export type BuildId = 'meta' | 'confronto' | 'adaptada'

export interface PlannedItem {
  id: number
  name: string
  plain: string
  role: 'inicial' | 'botas' | 'principal' | 'situacional'
  /** Por que este item (fatos usados). */
  why: string[]
  play?: number
  win?: number
}

export interface BuildEvidence {
  /** Amostra dos itens principais (partidas) e vitórias, quando conhecida. */
  play: number | null
  winRate: number | null
  label: string
}

export interface BehaviorGroup {
  phase: string
  items: { text: string; because?: string }[]
}

export interface PlannedBuild {
  id: BuildId
  title: string
  subtitle: string
  archetype: string
  items: PlannedItem[]
  runes: { page: RunePage; sample: string } | null
  spells: { ids: number[]; names: string[]; sample: string } | null
  skills: { order: string[]; priority: string[]; sample: string } | null
  evidence: BuildEvidence
  /** O que na composição dos times mudou esta build em relação à base da meta. */
  adaptations: string[]
  objective: string
  behavior: BehaviorGroup[]
  caveats: string[]
}

export interface MatchupLine {
  kind: 'estatistica' | 'estilo' | 'heuristica' | 'riot' | 'opgg'
  text: string
  /** Origem, para o usuário saber o que é dado e o que é regra. */
  source: string
}

export interface MatchupAdvice {
  opponent: number
  probability: number
  verdict: 'favoravel' | 'equilibrado' | 'desfavoravel' | 'sem-dados'
  headline: string
  record: { play: number; win: number; winRate: number } | null
  lines: MatchupLine[]
  uncertainty: string | null
}

export interface TeamSummary {
  allies: { count: number; frontline: number; engage: number; peel: number; physical: number | null }
  enemies: { count: number; physical: number | null; frontline: number; cc: number; dive: number; sustain: number }
}

export interface GamePlan {
  champion: number
  position: Position
  matchup: MatchupAdvice | null
  builds: PlannedBuild[]
  team: TeamSummary
  warnings: string[]
}
