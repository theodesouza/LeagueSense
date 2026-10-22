import type { Draft, PlayerData } from '@core/types'
import type { DraftUpdate, GameflowPhase, LcuStatus } from '@shared/api'
import type { LcuCredentials } from './credentials'
import type { LcuHttpLike } from './http'
import { normalizeSession } from './normalize'
import { PHASE_EVENT, SESSION_EVENT, type LcuEvent, type LcuSocketLike, type SocketHandlers } from './socket'

export interface TrackerDeps {
  discover(allowProcessScan: boolean): Promise<LcuCredentials | null>
  createHttp(creds: LcuCredentials): LcuHttpLike
  openSocket(creds: LcuCredentials, handlers: SocketHandlers): LcuSocketLike
  now?: () => number
  /** Agendador injetável (testes usam um relógio falso). */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  pollSessionMs?: number
}

type L<T> = (v: T) => void

const KNOWN_PHASES: GameflowPhase[] = ['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame']
const asPhase = (v: unknown): GameflowPhase => (typeof v === 'string' && (KNOWN_PHASES as string[]).includes(v) ? (v as GameflowPhase) : 'Unknown')

/** Estados do cliente: procura → conecta → conectado → (reconectando). Cuida de ordem de eventos e de épocas de draft. */
export class LcuTracker {
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void

  private status: LcuStatus = { state: 'searching', phase: 'None', lastEventAt: null, attempt: 0, detail: null, region: null }
  private http: LcuHttpLike | null = null
  private socket: LcuSocketLike | null = null
  private creds: LcuCredentials | null = null
  private running = false
  private connectionId = 0
  private retryTimer: unknown = null
  private pollTimer: unknown = null
  private scanTick = 0

  // controle de draft
  private epoch = ''
  /** Épocas (gameId) já encerradas: sessões atrasadas delas nunca voltam a valer. */
  private readonly retired = new Set<string>()
  private lastCounter = -1
  private requestSeq = 0
  private appliedSeq = 0
  private draftUpdate: DraftUpdate = { epoch: '', draft: null, updatedAt: 0 }
  private player: PlayerData = { owned: null, mastery: {} }
  private fallbackEpoch = 0

  private statusL = new Set<L<LcuStatus>>()
  private draftL = new Set<L<DraftUpdate>>()
  private playerL = new Set<L<PlayerData>>()

  constructor(private readonly deps: TrackerDeps) {
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  onStatus(cb: L<LcuStatus>): () => void {
    this.statusL.add(cb)
    return () => this.statusL.delete(cb)
  }
  onDraft(cb: L<DraftUpdate>): () => void {
    this.draftL.add(cb)
    return () => this.draftL.delete(cb)
  }
  onPlayer(cb: L<PlayerData>): () => void {
    this.playerL.add(cb)
    return () => this.playerL.delete(cb)
  }
  getStatus(): LcuStatus {
    return this.status
  }
  getDraft(): DraftUpdate {
    return this.draftUpdate
  }
  getPlayer(): PlayerData {
    return this.player
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.setStatus({ state: 'searching', attempt: 0, detail: null })
    void this.search()
  }

  stop(): void {
    this.running = false
    this.teardown()
    if (this.retryTimer) this.clearTimer(this.retryTimer)
    this.retryTimer = null
  }

  /** Força uma nova busca imediata (botão "tentar de novo"). */
  reconnect(): void {
    this.teardown()
    if (this.retryTimer) this.clearTimer(this.retryTimer)
    this.retryTimer = null
    this.setStatus({ state: 'searching', attempt: 0, detail: null })
    void this.search(true)
  }

  /* ------------------------------ conexão ------------------------------ */

  private setStatus(patch: Partial<LcuStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.statusL) l(this.status)
  }

  private teardown(): void {
    this.connectionId++
    this.socket?.close()
    this.http?.close()
    this.socket = null
    this.http = null
    this.creds = null
    if (this.pollTimer) this.clearTimer(this.pollTimer)
    this.pollTimer = null
  }

  private scheduleRetry(ms: number): void {
    if (!this.running) return
    if (this.retryTimer) this.clearTimer(this.retryTimer)
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null
      void this.search()
    }, ms)
  }

  private async search(forceScan = false): Promise<void> {
    if (!this.running) return
    // a varredura de processos é cara: só a cada 3 tentativas (ou quando forçada)
    const scan = forceScan || this.scanTick++ % 3 === 0
    let creds: LcuCredentials | null = null
    try {
      creds = await this.deps.discover(scan)
    } catch {
      creds = null
    }
    if (!this.running) return
    if (!creds) {
      if (this.status.state !== 'searching') this.setStatus({ state: 'searching', phase: 'None', detail: null })
      this.clearDraft()
      return this.scheduleRetry(3000)
    }
    await this.connect(creds)
  }

  private async connect(creds: LcuCredentials): Promise<void> {
    const id = ++this.connectionId
    const reconnecting = this.status.attempt > 0
    this.setStatus({ state: reconnecting ? 'reconnecting' : 'connecting', detail: null })
    this.creds = creds
    const http = this.deps.createHttp(creds)
    this.http = http
    try {
      const phase = await http.get<string>('/lol-gameflow/v1/gameflow-phase')
      if (id !== this.connectionId) return
      this.setStatus({ state: 'connected', attempt: 0, phase: asPhase(phase), lastEventAt: this.now(), detail: http.tlsMode === 'loopback-insecure' ? 'conexão local sem validação da CA da Riot (somente 127.0.0.1)' : null })
    } catch (e) {
      if (id !== this.connectionId) return
      return this.failed(e instanceof Error ? e.message : 'falha ao conectar')
    }

    this.socket = this.deps.openSocket(creds, {
      onOpen: () => undefined,
      onEvent: (ev) => id === this.connectionId && this.handleEvent(ev),
      onClose: (reason) => id === this.connectionId && this.failed(`conexão encerrada (${reason})`)
    })
    void this.loadPlayer(id)
    void this.loadRegion(id)
    if (this.status.phase === 'ChampSelect') void this.pollSession(id)
  }

  private failed(detail: string): void {
    this.teardown()
    const attempt = this.status.attempt + 1
    this.setStatus({ state: 'reconnecting', attempt, detail })
    this.scheduleRetry(Math.min(1000 * 2 ** Math.min(attempt - 1, 3), 10_000))
  }

  /* ------------------------------ eventos ------------------------------ */

  private handleEvent(ev: LcuEvent): void {
    this.setStatus({ lastEventAt: this.now() })
    if (ev.event === PHASE_EVENT) {
      const phase = asPhase(ev.data)
      this.onPhase(phase)
    } else if (ev.event === SESSION_EVENT) {
      if (ev.eventType === 'Delete') return this.clearDraft()
      this.applySession(ev.data, this.requestSeq)
    }
  }

  private onPhase(phase: GameflowPhase): void {
    const prev = this.status.phase
    this.setStatus({ phase })
    if (phase === 'ChampSelect') {
      if (prev !== 'ChampSelect') {
        this.resetEpoch()
        void this.pollSession(this.connectionId)
      }
    } else if (prev === 'ChampSelect') {
      this.clearDraft()
    }
  }

  private resetEpoch(): void {
    this.epoch = ''
    this.lastCounter = -1
    this.fallbackEpoch++
  }

  private retire(epoch: string): void {
    if (!epoch) return
    this.retired.add(epoch)
    if (this.retired.size > 20) this.retired.delete(this.retired.values().next().value as string)
  }

  private clearDraft(): void {
    this.retire(this.epoch)
    this.epoch = ''
    this.lastCounter = -1
    this.requestSeq++ // invalida respostas REST em voo
    this.appliedSeq = this.requestSeq
    if (this.pollTimer) this.clearTimer(this.pollTimer)
    this.pollTimer = null
    if (this.draftUpdate.draft !== null) {
      this.draftUpdate = { epoch: '', draft: null, updatedAt: this.now() }
      for (const l of this.draftL) l(this.draftUpdate)
    }
  }

  /** `seq` identifica a requisição que originou os dados; respostas mais antigas que a última aplicada são descartadas. */
  private applySession(raw: unknown, seq: number): void {
    if (seq < this.appliedSeq) return
    const n = normalizeSession(raw, `cs-${this.fallbackEpoch}`)
    if (!n) return
    if (n.isSpectating) return
    const epoch = n.draft.id
    if (this.retired.has(epoch)) return // sessão atrasada de uma seleção que já terminou
    if (epoch !== this.epoch) {
      // outra seleção de campeões: aposenta a anterior e zera o contador
      this.retire(this.epoch)
      this.epoch = epoch
      this.lastCounter = -1
    }
    if (n.counter <= this.lastCounter) return // evento antigo ou repetido
    this.lastCounter = n.counter
    this.appliedSeq = Math.max(this.appliedSeq, seq)
    this.emitDraft(n.draft)
  }

  private emitDraft(draft: Draft): void {
    this.draftUpdate = { epoch: this.epoch, draft, updatedAt: this.now() }
    for (const l of this.draftL) l(this.draftUpdate)
  }

  /** Consulta a sessão e, enquanto estivermos na seleção, repete (rede de segurança para eventos perdidos). */
  private async pollSession(connId: number): Promise<void> {
    if (connId !== this.connectionId || !this.http) return
    const seq = ++this.requestSeq
    try {
      const raw = await this.http.get('/lol-champ-select/v1/session')
      if (connId !== this.connectionId) return
      if (raw != null && this.status.phase === 'ChampSelect') this.applySession(raw, seq)
    } catch {
      /* os eventos do socket seguem valendo; o próximo ciclo tenta de novo */
    }
    if (connId === this.connectionId && this.status.phase === 'ChampSelect') {
      this.pollTimer = this.setTimer(() => void this.pollSession(connId), this.deps.pollSessionMs ?? 1500)
    }
  }

  /* ------------------------- dados pessoais (somente leitura) ------------------------- */

  private async loadPlayer(connId: number): Promise<void> {
    const http = this.http
    if (!http) return
    const next: PlayerData = { owned: null, mastery: {} }
    try {
      const champs = await http.get<unknown[]>('/lol-champions/v1/owned-champions-minimal')
      if (Array.isArray(champs)) {
        const ids: number[] = []
        for (const c of champs) {
          const o = c as { id?: unknown; ownership?: { owned?: unknown; rental?: { rented?: unknown } }; freeToPlay?: unknown }
          if (typeof o.id === 'number' && (o.ownership?.owned === true || o.ownership?.rental?.rented === true || o.freeToPlay === true)) ids.push(o.id)
        }
        if (ids.length > 0) next.owned = ids
      }
    } catch {
      /* posse desconhecida: não filtra nada */
    }
    try {
      const m = await http.get<unknown[]>('/lol-champion-mastery/v1/local-player/champion-mastery')
      if (Array.isArray(m)) {
        for (const e of m) {
          const o = e as { championId?: unknown; championPoints?: unknown; championLevel?: unknown }
          if (typeof o.championId === 'number' && typeof o.championPoints === 'number') {
            next.mastery[o.championId] = { points: o.championPoints, level: typeof o.championLevel === 'number' ? o.championLevel : 0 }
          }
        }
      }
    } catch {
      /* sem maestria */
    }
    if (connId !== this.connectionId) return
    this.player = next
    for (const l of this.playerL) l(next)
  }

  private async loadRegion(connId: number): Promise<void> {
    try {
      const r = await this.http?.get<{ region?: unknown; webRegion?: unknown }>('/riotclient/region-locale')
      if (connId !== this.connectionId) return
      const region = typeof r?.region === 'string' ? r.region : typeof r?.webRegion === 'string' ? r.webRegion : null
      if (region) this.setStatus({ region })
    } catch {
      /* só exibição */
    }
  }
}
