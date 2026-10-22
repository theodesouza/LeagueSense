import { describe, expect, it, vi } from 'vitest'
import { discoverCredentials, parseCommandLine, parseLockfile } from '../src/main/lcu/credentials'
import { LcuHttp } from '../src/main/lcu/http'
import { mapPosition, normalizeSession } from '../src/main/lcu/normalize'
import { openLcuSocket, parseWsMessage, PHASE_EVENT, SESSION_EVENT } from '../src/main/lcu/socket'
import { LcuTracker, type TrackerDeps } from '../src/main/lcu/tracker'
import type { LcuHttpLike } from '../src/main/lcu/http'
import type { DraftUpdate, LcuStatus } from '../src/shared/api'
import { FakeLcu, makeSession } from './helpers/fake-lcu'

describe('credenciais', () => {
  it('lockfile', () => {
    expect(parseLockfile('LeagueClient:4242:51234:s3cret-token:https\n')).toEqual({ port: 51234, password: 's3cret-token', scheme: 'https', source: 'lockfile' })
    expect(parseLockfile('lixo')).toBeNull()
    expect(parseLockfile('LeagueClient:1:99999:x:https')).toBeNull()
    expect(parseLockfile('LeagueClient:1:5000::https')).toBeNull()
    expect(parseLockfile('LeagueClient:1:5000:x:ftp')).toBeNull()
  })

  it('linha de comando do LeagueClientUx', () => {
    const cmd = '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" "--riotclient-auth-token=abc" "--app-port=61000" "--remoting-auth-token=Xy-9_Zq" "--region=BR"'
    expect(parseCommandLine(cmd)).toEqual({ port: 61000, password: 'Xy-9_Zq', scheme: 'https', source: 'process' })
    expect(parseCommandLine('LeagueClientUx.exe --foo')).toBeNull()
  })

  it('prefere lockfile; só varre processos quando permitido', async () => {
    const exec = vi.fn(async () => 'x --app-port=5555 --remoting-auth-token=ptok')
    const base = { platform: 'win32' as const, exec, installDirs: ['C:\\A', 'C:\\B'] }
    const readFile = async (p: string): Promise<string> => {
      if (p.includes('B')) return 'LeagueClient:1:4000:ftok:https'
      throw new Error('ENOENT')
    }
    const a = await discoverCredentials({ ...base, readFile, allowProcessScan: true })
    expect(a?.source).toBe('lockfile')
    expect(exec).not.toHaveBeenCalled()
    const none = async (): Promise<string> => {
      throw new Error('ENOENT')
    }
    expect(await discoverCredentials({ ...base, readFile: none, allowProcessScan: false })).toBeNull()
    expect(exec).not.toHaveBeenCalled()
    const b = await discoverCredentials({ ...base, readFile: none, allowProcessScan: true })
    expect(b).toMatchObject({ source: 'process', port: 5555 })
    expect(exec).toHaveBeenCalledOnce()
  })

  it('falha de execução do comando vira "não encontrado"', async () => {
    const r = await discoverCredentials({
      platform: 'win32',
      readFile: async () => {
        throw new Error('x')
      },
      exec: async () => {
        throw new Error('sem permissão')
      },
      installDirs: [],
      allowProcessScan: true
    })
    expect(r).toBeNull()
  })
})

describe('normalizeSession', () => {
  const ranked = makeSession({
    counter: 12,
    localCellId: 2,
    myTeam: [
      { cellId: 0, championId: 266, position: 'top' }, // aliado confirmado (ação completa abaixo)
      { cellId: 1, intent: 64, position: 'jungle' }, // aliado só declarou intenção
      { cellId: 2, championId: 103, position: 'middle' }, // eu, passando o mouse
      { cellId: 3, position: 'bottom' },
      { cellId: 4, position: 'utility' }
    ],
    theirTeam: [{ cellId: 5, championId: 157 }, { cellId: 6 }, { cellId: 7 }, { cellId: 8 }, { cellId: 9 }],
    actions: [
      { actorCellId: 0, championId: 266, completed: true, type: 'pick', isAllyAction: true },
      { actorCellId: 2, championId: 103, completed: false, type: 'pick', isAllyAction: true, isInProgress: true },
      { actorCellId: 5, championId: 157, completed: true, type: 'pick', isAllyAction: false },
      { actorCellId: 0, championId: 11, completed: true, type: 'ban', isAllyAction: true },
      { actorCellId: 5, championId: 238, completed: true, type: 'ban', isAllyAction: false },
      { actorCellId: 1, championId: 8, completed: false, type: 'ban', isAllyAction: true, isInProgress: true }
    ],
    myTeamBans: [11],
    theirTeamBans: [238]
  })

  it('diferencia confirmados de temporários e identifica a mim e as posições', () => {
    const n = normalizeSession(ranked, 'fb')!
    const [a0, a1, a2, a3] = n.draft.allies
    expect(a0).toMatchObject({ champion: 266, state: 'locked', position: 'top', positionSource: 'assigned', isMe: false })
    expect(a1).toMatchObject({ champion: 64, state: 'hover', position: 'jungle' }) // intenção declarada
    expect(a2).toMatchObject({ champion: 103, state: 'hover', position: 'mid', isMe: true })
    expect(a3).toMatchObject({ champion: null, state: 'empty', position: 'adc' })
    expect(n.draft.allies[4]!.position).toBe('support')
    expect(n.draft.enemies[0]).toMatchObject({ champion: 157, state: 'locked', position: null, positionSource: 'none' })
    expect(n.draft.enemies[1]).toMatchObject({ champion: null, state: 'empty' })
    expect(n.draft.id).toBe('7001')
    expect(n.counter).toBe(12)
  })

  it('bans: confirmados vs provisórios, por lado, sem duplicar', () => {
    const n = normalizeSession(ranked, 'fb')!
    expect(n.draft.bansAllies.filter((b) => b.champion != null)).toEqual([
      { champion: 11, state: 'locked' },
      { champion: 8, state: 'hover' }
    ])
    expect(n.draft.bansEnemies[0]).toEqual({ champion: 238, state: 'locked' })
    expect(n.draft.phase).toBe('banning')
  })

  it('sem ações, a escolha atual conta como confirmada (blind pick) e a fase finalização também', () => {
    const blind = normalizeSession(
      { ...(makeSession({ counter: 1, myTeam: [{ cellId: 0, championId: 5 }], theirTeam: [{ cellId: 5, championId: 6 }] }) as object), actions: [] },
      'fb'
    )!
    expect(blind.draft.allies[0]).toMatchObject({ champion: 5, state: 'locked' })
    expect(blind.draft.enemies[0]).toMatchObject({ champion: 6, state: 'locked' })
    const fin = normalizeSession(
      makeSession({ counter: 9, phase: 'FINALIZATION', myTeam: [{ cellId: 0, championId: 5 }], theirTeam: [], actions: [{ actorCellId: 3, championId: 9, completed: false, type: 'pick', isAllyAction: true }] }),
      'fb'
    )!
    expect(fin.draft.phase).toBe('finalizing')
    expect(fin.draft.allies[0]!.state).toBe('locked')
  })

  it('é tolerante a lixo: nunca lança', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { myTeam: 'oops' }, { myTeam: [null, 7, { cellId: 'a' }], actions: [[null, 3, { championId: 'x' }]], bans: 5 }]) {
      expect(() => normalizeSession(bad, 'fb')).not.toThrow()
    }
    expect(normalizeSession({}, 'fb')).toBeNull()
  })

  it('mapeia posições do cliente', () => {
    expect(['top', 'jungle', 'middle', 'bottom', 'utility', '', 'x'].map(mapPosition)).toEqual(['top', 'jungle', 'mid', 'adc', 'support', null, null])
  })

  it('id de época usa o gameId; sem ele usa o auxiliar', () => {
    expect(normalizeSession({ ...(ranked as object), gameId: 0 }, 'cs-3')!.draft.id).toBe('cs-3')
  })
})

describe('parseWsMessage', () => {
  it('lê eventos opcode 8 e ignora o resto', () => {
    expect(parseWsMessage(JSON.stringify([8, 'OnJsonApiEvent_x', { data: 'Lobby', eventType: 'Update', uri: '/x' }]))).toEqual({ event: 'OnJsonApiEvent_x', eventType: 'Update', uri: '/x', data: 'Lobby' })
    expect(parseWsMessage('[5,"x"]')).toBeNull()
    expect(parseWsMessage('não-json')).toBeNull()
    expect(parseWsMessage('[8,5,{}]')).toBeNull()
  })
})

/* ---------------- rastreador com transporte simulado ---------------- */

class Harness {
  creds: { port: number; password: string; scheme: 'https'; source: 'lockfile' } | null = null
  handlers: Parameters<TrackerDeps['openSocket']>[1] | null = null
  sockets = 0
  gets: { path: string; resolve: (v: unknown) => void }[] = []
  responses = new Map<string, unknown>()
  hold = new Set<string>()
  timers: { fn: () => void; ms: number; id: number }[] = []
  private tid = 0
  clock = 1000
  statuses: LcuStatus[] = []
  drafts: DraftUpdate[] = []
  tracker: LcuTracker

  constructor() {
    const http: LcuHttpLike = {
      tlsMode: 'pinned',
      close: () => undefined,
      send: () => Promise.resolve(null),
      get: <T>(path: string): Promise<T | null> =>
        new Promise((resolve) => {
          const answer = (): void => resolve((this.responses.has(path) ? this.responses.get(path) : null) as T | null)
          if (this.hold.has(path)) this.gets.push({ path, resolve: answer })
          else answer()
        })
    }
    this.tracker = new LcuTracker({
      discover: async () => this.creds,
      createHttp: () => http,
      openSocket: (_c, h) => {
        this.handlers = h
        this.sockets++
        return { close: () => undefined }
      },
      now: () => this.clock,
      setTimer: (fn, ms) => {
        const id = ++this.tid
        this.timers.push({ fn, ms, id })
        return id
      },
      clearTimer: (h) => {
        this.timers = this.timers.filter((t) => t.id !== h)
      },
      pollSessionMs: 1500
    })
    this.tracker.onStatus((s) => this.statuses.push(s))
    this.tracker.onDraft((d) => this.drafts.push(d))
  }

  async settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await new Promise((r) => setImmediate(r))
  }
  async fire(maxMs = Infinity): Promise<void> {
    const due = this.timers.filter((t) => t.ms <= maxMs)
    this.timers = this.timers.filter((t) => !due.includes(t))
    for (const t of due) t.fn()
    await this.settle()
  }
  event(event: string, data: unknown, eventType = 'Update'): void {
    this.handlers!.onEvent({ event, eventType, uri: '', data })
  }
  releaseAll(): void {
    const g = this.gets.splice(0)
    for (const x of g) x.resolve(null)
  }
}

const session = (counter: number, champ0 = 0, gameId = 7001) =>
  makeSession({ gameId, counter, myTeam: [{ cellId: 0, championId: champ0, position: 'middle' }], theirTeam: [], actions: champ0 ? [{ actorCellId: 0, championId: champ0, completed: true, type: 'pick', isAllyAction: true }] : [] })

describe('LcuTracker', () => {
  it('sem cliente: "procurando"; ao achar: conecta, lê a fase e assina eventos', async () => {
    const h = new Harness()
    h.tracker.start()
    await h.settle()
    expect(h.tracker.getStatus().state).toBe('searching')
    expect(h.timers.length).toBe(1) // nova tentativa agendada

    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'Lobby')
    await h.fire()
    expect(h.tracker.getStatus()).toMatchObject({ state: 'connected', phase: 'Lobby', attempt: 0 })
    expect(h.sockets).toBe(1)
  })

  it('ChampSelect: consulta a sessão, emite o draft e descarta eventos antigos/repetidos pelo contador', async () => {
    const h = new Harness()
    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'None')
    h.tracker.start()
    await h.settle()

    h.responses.set('/lol-champ-select/v1/session', session(3, 0))
    h.event(PHASE_EVENT, 'ChampSelect')
    await h.settle()
    expect(h.drafts.at(-1)!.draft).not.toBeNull()
    const n = h.drafts.length

    h.event(SESSION_EVENT, session(5, 103))
    expect(h.drafts.at(-1)!.draft!.allies[0]!.champion).toBe(103)
    h.event(SESSION_EVENT, session(4, 999)) // chegou atrasado: ignorado
    h.event(SESSION_EVENT, session(5, 888)) // repetido: ignorado
    expect(h.drafts.at(-1)!.draft!.allies[0]!.champion).toBe(103)
    expect(h.drafts.length).toBe(n + 1)
  })

  it('resposta REST atrasada nunca sobrescreve um evento mais novo', async () => {
    const h = new Harness()
    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'ChampSelect')
    h.responses.set('/lol-champ-select/v1/session', session(2, 100))
    h.hold.add('/lol-champ-select/v1/session')
    h.tracker.start()
    await h.settle()
    expect(h.gets.length).toBeGreaterThan(0) // consulta REST em voo
    h.event(SESSION_EVENT, session(9, 200)) // o socket entrega algo mais novo primeiro
    expect(h.drafts.at(-1)!.draft!.allies[0]!.champion).toBe(200)
    h.releaseAll() // a resposta antiga (counter 2) chega depois
    await h.settle()
    expect(h.drafts.at(-1)!.draft!.allies[0]!.champion).toBe(200)
  })

  it('novo draft (outro gameId) reinicia o contador; sair da seleção limpa o estado e invalida respostas em voo', async () => {
    const h = new Harness()
    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'ChampSelect')
    h.responses.set('/lol-champ-select/v1/session', session(50, 100, 1))
    h.tracker.start()
    await h.settle()
    const first = h.drafts.at(-1)!
    expect(first.epoch).toBe('1')

    // sai da seleção
    h.hold.add('/lol-champ-select/v1/session')
    h.event(PHASE_EVENT, 'InProgress')
    expect(h.drafts.at(-1)).toMatchObject({ draft: null, epoch: '' })

    // nova seleção com contador MENOR (outro jogo): deve ser aceita
    h.event(PHASE_EVENT, 'Lobby')
    h.event(PHASE_EVENT, 'ChampSelect')
    await h.settle()
    h.event(SESSION_EVENT, session(1, 300, 2))
    expect(h.drafts.at(-1)!.epoch).toBe('2')
    expect(h.drafts.at(-1)!.draft!.allies[0]!.champion).toBe(300)

    // sessão do primeiro draft (já encerrado) chega tarde → ignorada: o draft atual não regride
    const count = h.drafts.length
    h.event(SESSION_EVENT, session(51, 100, 1))
    expect(h.drafts.length).toBe(count)
    expect(h.drafts.at(-1)).toMatchObject({ epoch: '2' })
    expect(h.drafts.at(-1)!.draft!.allies[0]!.champion).toBe(300)
  })

  it('evento Delete da sessão limpa o draft', async () => {
    const h = new Harness()
    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'ChampSelect')
    h.responses.set('/lol-champ-select/v1/session', session(1, 7))
    h.tracker.start()
    await h.settle()
    expect(h.drafts.at(-1)!.draft).not.toBeNull()
    h.event(SESSION_EVENT, null, 'Delete')
    expect(h.drafts.at(-1)!.draft).toBeNull()
  })

  it('queda do socket: reconecta com espera crescente e volta a "conectado"', async () => {
    const h = new Harness()
    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'Lobby')
    h.tracker.start()
    await h.settle()
    expect(h.tracker.getStatus().state).toBe('connected')

    h.handlers!.onClose('código 1006')
    expect(h.tracker.getStatus()).toMatchObject({ state: 'reconnecting', attempt: 1 })
    expect(h.timers.at(-1)!.ms).toBe(1000)

    // o cliente ainda não voltou: continua tentando, com espera maior
    h.creds = null
    await h.fire()
    expect(h.tracker.getStatus().state).toBe('searching')

    h.creds = { port: 2, password: 'novo', scheme: 'https', source: 'lockfile' }
    await h.fire()
    expect(h.tracker.getStatus()).toMatchObject({ state: 'connected', attempt: 0 })
    expect(h.sockets).toBe(2)
  })

  it('carrega posse e maestria (somente leitura) e região', async () => {
    const h = new Harness()
    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'Lobby')
    h.responses.set('/lol-champions/v1/owned-champions-minimal', [
      { id: 103, ownership: { owned: true } },
      { id: 11, ownership: { owned: false, rental: { rented: false } } },
      { id: 22, ownership: { owned: false }, freeToPlay: true },
      { id: 5, ownership: { owned: false, rental: { rented: true } } }
    ])
    h.responses.set('/lol-champion-mastery/v1/local-player/champion-mastery', [{ championId: 103, championPoints: 52000, championLevel: 12 }, { championId: 'x' }])
    h.responses.set('/riotclient/region-locale', { region: 'BR1' })
    const players: unknown[] = []
    h.tracker.onPlayer((p) => players.push(p))
    h.tracker.start()
    await h.settle()
    expect(players.at(-1)).toEqual({ owned: [103, 22, 5], mastery: { 103: { points: 52000, level: 12 } } })
    expect(h.tracker.getStatus().region).toBe('BR1')
  })

  it('falha ao carregar dados pessoais não impede o draft', async () => {
    const h = new Harness()
    h.creds = { port: 1, password: 'p', scheme: 'https', source: 'lockfile' }
    h.responses.set('/lol-gameflow/v1/gameflow-phase', 'Lobby')
    h.responses.set('/lol-champions/v1/owned-champions-minimal', 'quebrado')
    h.tracker.start()
    await h.settle()
    expect(h.tracker.getPlayer()).toEqual({ owned: null, mastery: {} })
    expect(h.tracker.getStatus().state).toBe('connected')
  })
})

/* ------------- integração real (HTTP + WebSocket) contra o LCU falso ------------- */

describe('integração com LCU falso (HTTP/WS reais)', () => {
  it('REST com autenticação Basic e 404 → null; WS assina e recebe eventos', async () => {
    const lcu = new FakeLcu()
    await lcu.start()
    try {
      const http = new LcuHttp({ port: lcu.port, password: lcu.token, scheme: 'http', source: 'lockfile' })
      expect(await http.get('/lol-gameflow/v1/gameflow-phase')).toBe('None')
      expect(await http.get('/lol-champ-select/v1/session')).toBeNull()
      const wrong = new LcuHttp({ port: lcu.port, password: 'errado', scheme: 'http', source: 'lockfile' })
      await expect(wrong.get('/lol-gameflow/v1/gameflow-phase')).rejects.toMatchObject({ status: 401 })

      const events: string[] = []
      const sock = openLcuSocket(
        { port: lcu.port, password: lcu.token, scheme: 'http', source: 'lockfile' },
        { onOpen: () => undefined, onEvent: (e) => events.push(`${e.event}:${String(e.data)}`), onClose: () => undefined }
      )
      await vi.waitFor(() => expect(lcu.subscriptions).toEqual([SESSION_EVENT, PHASE_EVENT]))
      lcu.emit(PHASE_EVENT, 'ChampSelect')
      await vi.waitFor(() => expect(events).toEqual([`${PHASE_EVENT}:ChampSelect`]))
      sock.close()
    } finally {
      await lcu.close()
    }
  })

  it('tracker real ponta a ponta: lockfile → conecta → draft ao vivo → sai da seleção', async () => {
    const lcu = new FakeLcu()
    await lcu.start()
    const drafts: DraftUpdate[] = []
    const tracker = new LcuTracker({
      discover: async () => ({ port: lcu.port, password: lcu.token, scheme: 'http', source: 'lockfile' }),
      createHttp: (c) => new LcuHttp(c),
      openSocket: (c, h) => openLcuSocket(c, h),
      pollSessionMs: 100
    })
    tracker.onDraft((d) => drafts.push(d))
    try {
      lcu.phase = 'ChampSelect'
      lcu.session = session(1, 0)
      tracker.start()
      await vi.waitFor(() => expect(tracker.getStatus().state).toBe('connected'))
      await vi.waitFor(() => expect(drafts.at(-1)?.draft).toBeTruthy())

      lcu.session = session(2, 103)
      lcu.emit(SESSION_EVENT, lcu.session)
      await vi.waitFor(() => expect(drafts.at(-1)!.draft!.allies[0]!.champion).toBe(103))

      // o socket cai: reconecta sozinho
      lcu.dropSockets()
      await vi.waitFor(() => expect(['reconnecting', 'connected']).toContain(tracker.getStatus().state))
      await vi.waitFor(() => expect(lcu.subscriptions.length).toBeGreaterThanOrEqual(4), { timeout: 8000 })

      lcu.phase = 'InProgress'
      lcu.emit(PHASE_EVENT, 'InProgress')
      await vi.waitFor(() => expect(drafts.at(-1)!.draft).toBeNull())
    } finally {
      tracker.stop()
      await lcu.close()
    }
  }, 20000)

  it('TLS: certificado fora da CA da Riot → fallback restrito ao loopback (e sinalizado)', async () => {
    if (!FakeLcu.makeCert()) return // openssl indisponível: teste não aplicável
    const lcu = new FakeLcu({ tls: true })
    await lcu.start()
    try {
      const http = new LcuHttp({ port: lcu.port, password: lcu.token, scheme: 'https', source: 'lockfile' })
      expect(http.tlsMode).toBe('pinned')
      expect(await http.get('/lol-gameflow/v1/gameflow-phase')).toBe('None')
      expect(http.tlsMode).toBe('loopback-insecure')
      http.close()
    } finally {
      await lcu.close()
    }
  })
})
