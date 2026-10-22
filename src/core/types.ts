/**
 * Tipos compartilhados entre main, preload e renderer.
 * O núcleo (`src/core`) não depende de Node, Electron nem do DOM.
 */

export const POSITIONS = ['top', 'jungle', 'mid', 'adc', 'support'] as const
export type Position = (typeof POSITIONS)[number]

export const POSITION_LABEL: Record<Position, string> = {
  top: 'Topo',
  jungle: 'Selva',
  mid: 'Meio',
  adc: 'Atirador',
  support: 'Suporte'
}

export interface ChampionInfo {
  /** `championId` do cliente (= `key` numérica do Data Dragon). */
  id: number
  /** Id do Data Dragon, ex.: "MonkeyKing" (usado em imagens). */
  key: string
  /** Nome em pt-BR. */
  name: string
  /** Nome em inglês (casamento com o OP.GG). */
  nameEn: string
  tags: string[]
}

/* ------------------------------------------------------------------ */
/* Draft                                                               */
/* ------------------------------------------------------------------ */

export type PickState = 'empty' | 'hover' | 'locked'
export type DraftSource = 'lcu' | 'manual' | 'demo'
export type DraftPhase = 'idle' | 'planning' | 'banning' | 'picking' | 'finalizing' | 'unknown'

export interface TeamSlot {
  champion: number | null
  state: PickState
  /** Posição declarada (atribuída pelo cliente ou definida manualmente). */
  position: Position | null
  positionSource: 'assigned' | 'manual' | 'none'
  isMe: boolean
}

export interface BanSlot {
  champion: number | null
  state: PickState
}

export interface Draft {
  /** Identidade da seleção (gameId do cliente, ou id local). Muda a cada novo draft. */
  id: string
  source: DraftSource
  phase: DraftPhase
  allies: TeamSlot[]
  enemies: TeamSlot[]
  bansAllies: BanSlot[]
  bansEnemies: BanSlot[]
}

/* ------------------------------------------------------------------ */
/* Elo / procedência                                                   */
/* ------------------------------------------------------------------ */

export const ELO_TIERS = [
  'ALL',
  'IBSG',
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'GOLD_PLUS',
  'PLATINUM',
  'PLATINUM_PLUS',
  'EMERALD',
  'EMERALD_PLUS',
  'DIAMOND',
  'DIAMOND_PLUS',
  'MASTER',
  'MASTER_PLUS',
  'GRANDMASTER',
  'CHALLENGER'
] as const
export type EloTier = (typeof ELO_TIERS)[number]

/**
 * Agregado que o OP.GG devolve quando `tier` é omitido e que as tabelas de
 * matchup/sinergia usam (inferido: as amostras coincidem com EMERALD_PLUS).
 */
export const DEFAULT_AGGREGATE_TIER: EloTier = 'EMERALD_PLUS'

export interface Provenance {
  source: 'opgg-mcp' | 'demo'
  /** Patch "major.minor" dos dados (ex.: "16.21"), se o provedor informou. */
  patch: string | null
  /** Patch atual do jogo segundo o Data Dragon, para detectar defasagem. */
  currentPatch: string | null
  tier: EloTier
  /** Elo real das tabelas de matchup/sinergia (podem diferir do selecionado). */
  tableTier: EloTier
  /** O provedor não permite filtrar por região. */
  region: 'global'
  queue: 'ranked-solo-duo'
  /** Epoch ms da obtenção mais antiga entre os dados usados. */
  fetchedAt: number | null
  fromCache: boolean
}

/* ------------------------------------------------------------------ */
/* Estatísticas (instantâneo serializável)                             */
/* ------------------------------------------------------------------ */

export interface BaseStat {
  play: number
  win: number
  roleRate: number
  pickRate: number
  banRate: number
  /** true quando `win` foi reconstruído de uma taxa arredondada a 2 casas. */
  rounded?: boolean
}

export interface MatchupTable {
  /** oponente → partidas e vitórias do campeão da tabela. */
  entries: Record<number, { play: number; win: number }>
  fetchedAt: number
  patch?: string | null
}

export interface SynergyTable {
  entries: Record<number, { play: number; win: number }>
  fetchedAt: number
  patch?: string | null
}

export type PositionRecord<T> = Partial<Record<Position, T>>

export interface StatsSnapshot {
  provenance: Provenance
  /** Base no elo selecionado: posição → campeão → estatística. */
  base: PositionRecord<Record<number, BaseStat>>
  /** Base no agregado padrão (referência para matchup/sinergia). */
  baseDefault: PositionRecord<Record<number, BaseStat>>
  /** Frequência de cada campeão por rota (para inferir posições). */
  roleRates: Record<number, PositionRecord<number>>
  /** `${campeão}:${rota}` → tabela de confrontos. */
  matchups: Record<string, MatchupTable>
  /** `${campeão}:${rotaMinha}:${rotaAliado}` → sinergias. */
  synergies: Record<string, SynergyTable>
}

export const matchupKey = (champion: number, position: Position): string => `${champion}:${position}`
export const synergyKey = (champion: number, mine: Position, ally: Position): string =>
  `${champion}:${mine}:${ally}`

/* ------------------------------------------------------------------ */
/* Preferências                                                        */
/* ------------------------------------------------------------------ */

export type Familiarity = 1 | 2 | 3 | 4
export const FAMILIARITY_LABEL: Record<Familiarity, string> = {
  1: 'Aprendendo',
  2: 'Confortável',
  3: 'Dominado',
  4: 'Especialista'
}

export interface Preferences {
  /** Posição fixa; `null` = usar a atribuída pelo cliente (ou a última escolhida). */
  position: Position | null
  elo: EloTier
  region: string
  /** campeão → familiaridade (pool pessoal). */
  pool: Record<number, Familiarity>
  restrictToPool: boolean
  /** Campeões que não quero ver (não possuo / não quero jogar). */
  excluded: number[]
  /** Usar a posse informada pelo cliente para esconder campeões bloqueados. */
  hideUnowned: boolean
  /** Peso das preferências pessoais: 0.5 (meta), 1 (equilibrado), 1.5 (conforto). */
  familiarityWeight: 0.5 | 1 | 1.5
  motion: 'system' | 'reduced' | 'full'
  /** O que "Usar esta build" envia ao cliente do jogo (feitiços ficam desligados por padrão). */
  sendBuild: { items: boolean; runes: boolean; spells: boolean }
}

export const DEFAULT_PREFERENCES: Preferences = {
  position: null,
  elo: 'EMERALD_PLUS',
  region: 'BR',
  pool: {},
  restrictToPool: false,
  excluded: [],
  hideUnowned: true,
  familiarityWeight: 1,
  motion: 'system',
  sendBuild: { items: true, runes: true, spells: false }
}

/** Dados pessoais vindos do cliente (somente leitura). */
export interface PlayerData {
  /** Ids possuídos; `null` = desconhecido. */
  owned: number[] | null
  mastery: Record<number, { points: number; level: number }>
}

/* ------------------------------------------------------------------ */
/* Recomendações                                                       */
/* ------------------------------------------------------------------ */

export type ReasonKind =
  | 'base'
  | 'matchup'
  | 'synergy'
  | 'damage'
  | 'frontline'
  | 'engage'
  | 'cc'
  | 'peel'
  | 'disengage'
  | 'range'
  | 'familiarity'

export interface Factor {
  kind: ReasonKind
  group: 'estatistica' | 'composicao' | 'pessoal'
  /** Contribuição em pontos percentuais equivalentes (não é chance de vitória). */
  pp: number
  /** Texto em pt-BR já com números; descreve exatamente o que o algoritmo usou. */
  text: string
  /** Peso estatístico do fator (0–1), quando aplicável. */
  confidence?: number
}

export type DataQuality = 'ok' | 'partial' | 'insufficient'

export interface Caveat {
  kind:
    | 'low-sample'
    | 'no-stats'
    | 'no-matchup-data'
    | 'uncertain-opponent'
    | 'mixed-tier'
    | 'stale'
    | 'patch-mismatch'
    | 'ally-hover'
    | 'no-synergy-data'
    | 'off-role'
  text: string
}

export interface Recommendation {
  championId: number
  /** 0–100, relativa ao contexto; não é probabilidade de vitória. */
  score: number
  /** Soma das contribuições (pp equivalentes), usada para ordenar. */
  totalPp: number
  factors: Factor[]
  /** 2–3 motivos concretos (fatores positivos mais fortes). */
  reasons: Factor[]
  /** Principal desvantagem ou risco. */
  risk: { text: string; kind: Factor['kind'] | Caveat['kind'] } | null
  caveats: Caveat[]
  quality: DataQuality
  sample: { base: number | null; lane: number | null }
  baseWinRate: number | null
  /** Oponentes de rota considerados e suas probabilidades. */
  laneOpponents: { champion: number; probability: number; play: number | null; winRate: number | null }[]
  familiarity: { level: Familiarity | null; source: 'pool' | 'maestria' | 'nenhuma'; points?: number }
}

export type EngineStatus = 'ok' | 'no-stats' | 'insufficient' | 'no-position'

export interface RecommendationResult {
  status: EngineStatus
  items: Recommendation[]
  /** Ordem estável de TODOS os candidatos (ids), usada como histórico da próxima ordenação. */
  ranking: number[]
  /** Quantos candidatos foram considerados e quantos foram excluídos por regra. */
  considered: number
  excludedCount: number
  warnings: Caveat[]
  position: Position | null
  /** Por que o 1º está no topo (comparado ao 2º). */
  rankExplanation: import('./explain-rank').RankExplanation | null
  /** Distribuição do oponente de rota (para exibição da incerteza). */
  laneOpponentDistribution: { champion: number; probability: number }[]
  provenance: Provenance | null
}
