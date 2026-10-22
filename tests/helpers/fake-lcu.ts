import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttps } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'

export interface FakeLcuOptions {
  tls?: boolean
  token?: string
}

/**
 * LCU FALSO para testes e para verificar o app sem o cliente do jogo.
 * Reproduz os endpoints e o protocolo WAMP simplificado (`[5,"evento"]` / `[8,"evento",{...}]`)
 * conforme a documentação da comunidade e os tipos gerados do cliente. NÃO é o cliente real.
 */
export class FakeLcu {
  readonly token: string
  port = 0
  phase = 'None'
  session: unknown = null
  owned: unknown[] = []
  mastery: unknown[] = []
  region: unknown = { region: 'BR1', webRegion: 'BR', locale: 'pt_BR' }
  /** Atrasos artificiais (ms) por caminho, para simular respostas fora de ordem. */
  delays = new Map<string, number>()
  requests: string[] = []
  /** Escritas recebidas (método, caminho, corpo já decodificado). */
  writes: { method: string; path: string; body: unknown }[] = []
  /** Conta do invocador local, itens e páginas de runas (para testar o envio de builds). */
  summoner = { summonerId: 4242, accountId: 777 }
  itemSets: { timestamp: number; accountId: number; itemSets: Record<string, unknown>[] } = { timestamp: 1, accountId: 777, itemSets: [] }
  pages: { id: number; name: string; isEditable: boolean; isDeletable: boolean; primaryStyleId?: number; subStyleId?: number; selectedPerkIds?: number[] }[] = []
  pageCapacity = 3
  currentPage = 0
  mySelection: unknown = null
  /** caminho → status HTTP a devolver em escritas (simula recusa do cliente). */
  failWrites = new Map<string, number>()
  private nextPageId = 100
  subscriptions: string[] = []
  badAuth = 0
  private server!: Server
  private wss!: WebSocketServer
  private sockets = new Set<WebSocket>()

  constructor(private readonly opts: FakeLcuOptions = {}) {
    this.token = opts.token ?? 'tok-' + Math.random().toString(36).slice(2)
  }

  static makeCert(): { key: string; cert: string } | null {
    try {
      const dir = mkdtempSync(join(tmpdir(), 'ls-cert-'))
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' })
      return { key: readFileSync(join(dir, 'k.pem'), 'utf8'), cert: readFileSync(join(dir, 'c.pem'), 'utf8') }
    } catch {
      return null
    }
  }

  private authorized(req: IncomingMessage): boolean {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from(`riot:${this.token}`).toString('base64')
    if (!ok) this.badAuth++
    return ok
  }

  private writeRoute(method: string, path: string, body: unknown): { status: number; body: unknown } {
    const fail = this.failWrites.get(path)
    if (fail) return { status: fail, body: { message: 'recusado' } }
    const sets = /^\/lol-item-sets\/v1\/item-sets\/(\d+)\/sets$/.exec(path)
    if (sets && method === 'PUT') {
      const b = body as typeof this.itemSets
      if (!b || !Array.isArray(b.itemSets)) return { status: 400, body: { message: 'itemSets inválido' } }
      this.itemSets = { timestamp: this.itemSets.timestamp + 1, accountId: b.accountId, itemSets: b.itemSets }
      return { status: 204, body: null }
    }
    if (path === '/lol-perks/v1/pages' && method === 'POST') {
      if (this.pages.length >= this.pageCapacity) return { status: 400, body: { message: 'sem espaço' } }
      const b = body as { name: string; primaryStyleId: number; subStyleId: number; selectedPerkIds: number[] }
      const page = { id: this.nextPageId++, name: b.name, isEditable: true, isDeletable: true, primaryStyleId: b.primaryStyleId, subStyleId: b.subStyleId, selectedPerkIds: b.selectedPerkIds }
      this.pages.push(page)
      return { status: 200, body: page }
    }
    const page = /^\/lol-perks\/v1\/pages\/(\d+)$/.exec(path)
    if (page) {
      const i = this.pages.findIndex((p) => p.id === Number(page[1]))
      if (i < 0) return { status: 404, body: { message: 'página inexistente' } }
      if (method === 'PUT') {
        const b = body as { name: string; primaryStyleId: number; subStyleId: number; selectedPerkIds: number[] }
        this.pages[i] = { ...this.pages[i]!, name: b.name, primaryStyleId: b.primaryStyleId, subStyleId: b.subStyleId, selectedPerkIds: b.selectedPerkIds }
        return { status: 200, body: this.pages[i] }
      }
      if (method === 'DELETE') {
        this.pages.splice(i, 1)
        return { status: 204, body: null }
      }
    }
    if (path === '/lol-perks/v1/currentpage' && method === 'PUT') {
      this.currentPage = Number(body)
      return { status: 204, body: null }
    }
    if (path === '/lol-champ-select/v1/session/my-selection' && method === 'PATCH') {
      if (this.phase !== 'ChampSelect') return { status: 404, body: { message: 'sem seleção' } }
      this.mySelection = body
      return { status: 204, body: null }
    }
    return { status: 404, body: { message: 'not found' } }
  }

  private route(path: string): { status: number; body: unknown } {
    switch (path) {
      case '/lol-summoner/v1/current-summoner':
        return { status: 200, body: this.summoner }
      case '/lol-perks/v1/pages':
        return { status: 200, body: this.pages }
      case '/lol-perks/v1/inventory':
        return { status: 200, body: { ownedPageCount: this.pages.length, customPageCount: this.pages.length, canAddCustomPage: this.pages.length < this.pageCapacity, isCustomPageCreationUnlocked: true } }
      case `/lol-item-sets/v1/item-sets/${this.summoner.summonerId}/sets`:
        return { status: 200, body: this.itemSets }
      case '/lol-gameflow/v1/gameflow-phase':
        return { status: 200, body: this.phase }
      case '/lol-champ-select/v1/session':
        return this.session == null
          ? { status: 404, body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'No active delegate' } }
          : { status: 200, body: this.session }
      case '/lol-champions/v1/owned-champions-minimal':
        return { status: 200, body: this.owned }
      case '/lol-champion-mastery/v1/local-player/champion-mastery':
        return { status: 200, body: this.mastery }
      case '/riotclient/region-locale':
        return { status: 200, body: this.region }
      default:
        return { status: 404, body: { message: 'not found' } }
    }
  }

  private handle = (req: IncomingMessage, res: ServerResponse): void => {
    if (!this.authorized(req)) {
      res.writeHead(401).end()
      return
    }
    const path = req.url ?? ''
    const method = req.method ?? 'GET'
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      this.requests.push(path)
      let result: { status: number; body: unknown }
      if (method === 'GET') result = this.route(path)
      else {
        let parsed: unknown = null
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          parsed = raw ? JSON.parse(raw) : null
        } catch {
          parsed = raw
        }
        this.writes.push({ method, path, body: parsed })
        result = this.writeRoute(method, path, parsed)
      }
      const { status, body } = result
      const send = (): void => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(status === 204 || body == null ? undefined : JSON.stringify(body))
      }
      const d = this.delays.get(path)
      if (d) setTimeout(send, d)
      else send()
    })
  }

  async start(): Promise<void> {
    if (this.opts.tls) {
      const c = FakeLcu.makeCert()
      if (!c) throw new Error('openssl indisponível')
      this.server = createHttps({ key: c.key, cert: c.cert }, this.handle)
    } else {
      this.server = createHttp(this.handle)
    }
    this.wss = new WebSocketServer({
      server: this.server,
      verifyClient: (info: { req: IncomingMessage }) => this.authorized(info.req)
    })
    this.wss.on('connection', (ws) => {
      this.sockets.add(ws)
      ws.on('close', () => this.sockets.delete(ws))
      ws.on('message', (m) => {
        try {
          const msg = JSON.parse(m.toString()) as unknown[]
          if (msg[0] === 5 && typeof msg[1] === 'string') this.subscriptions.push(msg[1])
        } catch {
          /* ignora */
        }
      })
    })
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    this.port = (this.server.address() as { port: number }).port
  }

  get scheme(): 'http' | 'https' {
    return this.opts.tls ? 'https' : 'http'
  }

  lockfile(): string {
    return `LeagueClient:1234:${this.port}:${this.token}:${this.scheme}`
  }

  /** Publica um evento para os assinantes (`[8, evento, {data,eventType,uri}]`). */
  emit(event: string, data: unknown, eventType = 'Update'): void {
    const msg = JSON.stringify([8, event, { data, eventType, uri: '/' + event }])
    for (const ws of this.sockets) if (ws.readyState === 1) ws.send(msg)
  }

  dropSockets(): void {
    for (const ws of this.sockets) ws.terminate()
  }

  async close(): Promise<void> {
    this.dropSockets()
    await new Promise<void>((r) => this.wss.close(() => r()))
    this.server.closeAllConnections?.()
    await new Promise<void>((r) => this.server.close(() => r()))
  }
}

/* ----------------------- construtores de sessões de seleção ----------------------- */

export interface CellSpec {
  cellId: number
  championId?: number
  intent?: number
  position?: string
}

export function makeSession(opts: {
  gameId?: number
  counter: number
  localCellId?: number
  phase?: string
  myTeam: CellSpec[]
  theirTeam: CellSpec[]
  actions?: { actorCellId: number; championId: number; completed: boolean; type: 'pick' | 'ban'; isAllyAction: boolean; isInProgress?: boolean }[]
  myTeamBans?: number[]
  theirTeamBans?: number[]
}): unknown {
  const cell = (c: CellSpec, team: number) => ({
    cellId: c.cellId,
    championId: c.championId ?? 0,
    championPickIntent: c.intent ?? 0,
    assignedPosition: c.position ?? '',
    team,
    summonerId: 1000 + c.cellId,
    puuid: `p${c.cellId}`
  })
  return {
    gameId: opts.gameId ?? 7001,
    counter: opts.counter,
    localPlayerCellId: opts.localCellId ?? 0,
    isSpectating: false,
    timer: { phase: opts.phase ?? 'BAN_PICK', adjustedTimeLeftInPhase: 25000, totalTimeInPhase: 30000, isInfinite: false },
    myTeam: opts.myTeam.map((c) => cell(c, 1)),
    theirTeam: opts.theirTeam.map((c) => cell(c, 2)),
    actions: [(opts.actions ?? []).map((a, i) => ({ id: i, isInProgress: false, pickTurn: 1, ...a }))],
    bans: { myTeamBans: opts.myTeamBans ?? [], theirTeamBans: opts.theirTeamBans ?? [], numBans: 10 }
  }
}
