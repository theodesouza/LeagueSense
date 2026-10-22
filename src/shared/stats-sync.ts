import type { StatsSnapshot } from '@core/types'
import type { StatsUpdate } from './api'

export interface StatsSyncState {
  contextKey: string | null
  version: number
  snapshot: StatsSnapshot | null
}

export const initialStatsSync: StatsSyncState = { contextKey: null, version: 0, snapshot: null }

/**
 * Aceita uma atualização de estatísticas apenas se (a) pertence ao contexto atualmente
 * exibido e (b) é mais nova que a última aceita. Respostas atrasadas de outro contexto
 * (outra posição/elo/modo) ou duplicadas/antigas são descartadas.
 */
export function applyStatsUpdate(state: StatsSyncState, expectedKey: string, update: StatsUpdate): StatsSyncState {
  if (update.contextKey !== expectedKey) return state
  if (update.version <= state.version) return state
  return { contextKey: update.contextKey, version: update.version, snapshot: update.snapshot }
}
