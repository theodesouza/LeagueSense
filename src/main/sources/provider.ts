import type { GeneralBuildData, MatchupGuideData } from '@core/build-types'
import type { BaseStat, EloTier, Position, PositionRecord } from '@core/types'

export interface LaneMeta {
  byPosition: PositionRecord<Record<number, BaseStat>>
  roleRates: Record<number, PositionRecord<number>>
}

export interface TableEntries {
  entries: Record<number, { play: number; win: number }>
  patch: string | null
}

/** Fonte de estatísticas agregadas. Há uma real (OP.GG) e uma de demonstração (fictícia). */
export interface StatsProvider {
  readonly source: 'opgg-mcp' | 'demo'
  /** Win/pick/ban e frequência por rota, no agregado padrão do provedor (1 chamada). */
  laneMeta(): Promise<LaneMeta>
  /** Base de um campeão em um elo específico. */
  baseAtTier(champion: number, position: Position, tier: EloTier): Promise<{ stat: BaseStat; patch: string | null }>
  /** Tabela de confrontos de rota do campeão (agregado padrão). */
  matchups(champion: number, position: Position): Promise<TableEntries>
  /** Sinergias do campeão com aliados de outra rota (agregado padrão; só os melhores parceiros). */
  synergies(champion: number, mine: Position, ally: Position): Promise<TableEntries>
  /** Builds gerais do campeão (itens, botas, runas, feitiços, habilidades) no elo escolhido. */
  buildGeneral(champion: number, position: Position, tier: EloTier): Promise<GeneralBuildData>
  /** Guia do confronto: builds específicas contra o oponente + indicações de estilo. */
  matchupGuide(champion: number, opponent: number, position: Position): Promise<MatchupGuideData>
  /** Patch dos dados, quando o provedor informa. */
  patch(reference: { champion: number; position: Position }): Promise<string | null>
}
