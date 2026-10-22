/**
 * Contrato entre o processo principal e a interface (via preload / contextBridge).
 * Tudo aqui é serializável (structured clone).
 */
import type { ChampionInfo, Draft, EloTier, PlayerData, Preferences, Position, StatsSnapshot } from '@core/types'
import type { FetchPlan } from '@core/fetch-plan'

export type SourceName = 'ddragon' | 'opgg' | 'lcu'

export interface SourceError {
  source: SourceName
  kind: 'timeout' | 'network' | 'http' | 'rate-limit' | 'parse' | 'validation' | 'unavailable'
  /** Mensagem para o usuário, em linguagem simples. */
  message: string
  /** O que o usuário pode fazer. */
  action?: string
  at: number
}

export interface RosterPayload {
  /** Versão do Data Dragon (ex.: "16.21.1"). */
  version: string | null
  patch: string | null
  champions: ChampionInfo[]
  source: 'live' | 'cache' | 'bundled'
}

export type DataState = 'idle' | 'loading' | 'ready' | 'partial' | 'error'

export interface DataStatus {
  state: DataState
  /** Progresso das tabelas de confronto/sinergia. */
  progress: { done: number; total: number } | null
  errors: SourceError[]
  lastUpdated: number | null
  fromCache: boolean
  /** true no modo demonstração (dados fictícios). */
  demo: boolean
}

export interface StatsUpdate {
  /** Chave do contexto (posição+elo+modo); a interface ignora mensagens de outro contexto. */
  contextKey: string
  /** Contador crescente; a interface ignora versões mais antigas. */
  version: number
  snapshot: StatsSnapshot | null
}

export type LcuState = 'searching' | 'connecting' | 'connected' | 'reconnecting' | 'unsupported'
export type GameflowPhase =
  | 'None'
  | 'Lobby'
  | 'Matchmaking'
  | 'ReadyCheck'
  | 'ChampSelect'
  | 'GameStart'
  | 'InProgress'
  | 'Reconnect'
  | 'WaitingForStats'
  | 'PreEndOfGame'
  | 'EndOfGame'
  | 'Unknown'

export interface LcuStatus {
  state: LcuState
  phase: GameflowPhase
  /** Última atualização recebida do cliente (epoch ms). */
  lastEventAt: number | null
  /** Tentativa de reconexão atual (0 = nenhuma). */
  attempt: number
  detail: string | null
  /** Região do cliente (para exibição), quando disponível. */
  region: string | null
}

export interface DraftUpdate {
  /** Identidade do draft; muda a cada nova seleção de campeões. */
  epoch: string
  /** null = fora da seleção. */
  draft: Draft | null
  updatedAt: number
}

export interface AppInfo {
  version: string
  platform: string
  userData: string
  electron: string
  disclaimer: string
}

export interface LeagueSenseApi {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    clearCache(): Promise<void>
  }
  prefs: {
    get(): Promise<Preferences>
    set(patch: Partial<Preferences>): Promise<Preferences>
    onChange(cb: (p: Preferences) => void): () => void
  }
  roster: {
    get(): Promise<RosterPayload>
  }
  stats: {
    /** Pede (ou renova) dados para o plano. Resolve quando termina; atualizações chegam por onUpdate. */
    request(plan: FetchPlan, mode: 'live' | 'demo'): Promise<void>
    onUpdate(cb: (u: StatsUpdate) => void): () => void
    onStatus(cb: (s: DataStatus) => void): () => void
    status(): Promise<DataStatus>
    /** Descarta o cache e busca de novo. */
    refresh(): Promise<void>
  }
  lcu: {
    status(): Promise<LcuStatus>
    onStatus(cb: (s: LcuStatus) => void): () => void
    onDraft(cb: (u: DraftUpdate) => void): () => void
    currentDraft(): Promise<DraftUpdate>
    player(): Promise<PlayerData>
    onPlayer(cb: (p: PlayerData) => void): () => void
    /** Posição atribuída pelo cliente ao jogador local, se houver. */
    reconnect(): Promise<void>
  }
}

export type { ChampionInfo, Draft, EloTier, PlayerData, Preferences, Position, StatsSnapshot, FetchPlan }

declare global {
  interface Window {
    leaguesense: LeagueSenseApi
  }
}
