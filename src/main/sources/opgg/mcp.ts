import { SourceFailure } from '../../errors'
import { httpRequest } from '../../http'

export interface McpLike {
  callTool(name: string, args: Record<string, unknown>): Promise<string>
}

export interface McpOptions {
  url?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Chamadas simultâneas (padrão 3): educado com um serviço sem limites publicados. */
  concurrency?: number
  timeoutMs?: number
}

export const OPGG_MCP_URL = 'https://mcp-api.op.gg/mcp'

interface JsonRpcResponse {
  result?: { content?: { type: string; text?: string }[]; isError?: boolean }
  error?: { code: number; message: string }
}

/** Cliente mínimo de MCP (Streamable HTTP, JSON-RPC por POST) — só o necessário: initialize e tools/call. */
export class McpClient implements McpLike {
  private readonly url: string
  private readonly opts: McpOptions
  private session: Promise<string | null> | null = null
  private active = 0
  private readonly waiters: (() => void)[] = []
  private nextId = 1

  constructor(opts: McpOptions = {}) {
    this.opts = opts
    this.url = opts.url ?? OPGG_MCP_URL
  }

  private headers(sessionId: string | null): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    if (sessionId) h['Mcp-Session-Id'] = sessionId
    return h
  }

  private async acquire(): Promise<void> {
    const max = this.opts.concurrency ?? 3
    if (this.active < max) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active++
  }

  private release(): void {
    this.active--
    this.waiters.shift()?.()
  }

  private async parseBody(res: Response): Promise<JsonRpcResponse> {
    const text = await res.text()
    const ct = res.headers.get('content-type') ?? ''
    try {
      if (ct.includes('text/event-stream')) {
        const data = text
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .filter(Boolean)
        return JSON.parse(data[data.length - 1] ?? '{}') as JsonRpcResponse
      }
      return JSON.parse(text) as JsonRpcResponse
    } catch (e) {
      throw new SourceFailure('opgg', 'parse', 'resposta MCP inválida', { cause: e })
    }
  }

  private async initialize(): Promise<string | null> {
    const base = {
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
      timeoutMs: this.opts.timeoutMs ?? 20_000
    }
    const res = await httpRequest('opgg', this.url, {
      ...base,
      method: 'POST',
      headers: this.headers(null),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'leaguesense', version: '0.1.0' } }
      })
    })
    const sid = res.headers.get('mcp-session-id')
    await this.parseBody(res)
    await httpRequest('opgg', this.url, {
      ...base,
      method: 'POST',
      headers: this.headers(sid),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      retries: 0
    }).catch(() => undefined) // notificação: falha aqui não impede o uso
    return sid
  }

  private ensureSession(): Promise<string | null> {
    if (!this.session) {
      this.session = this.initialize().catch((e) => {
        this.session = null
        throw e
      })
    }
    return this.session
  }

  /** Executa uma ferramenta e devolve o texto da resposta. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.acquire()
    try {
      return await this.callOnce(name, args, true)
    } finally {
      this.release()
    }
  }

  private async callOnce(name: string, args: Record<string, unknown>, mayRetrySession: boolean): Promise<string> {
    const sid = await this.ensureSession()
    let res: Response
    try {
      res = await httpRequest('opgg', this.url, {
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
        ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
        timeoutMs: this.opts.timeoutMs ?? 30_000,
        method: 'POST',
        headers: this.headers(sid),
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } })
      })
    } catch (e) {
      // sessão expirada: recomeça uma vez
      if (mayRetrySession && e instanceof SourceFailure && e.kind === 'http' && (e.status === 404 || e.status === 400)) {
        this.session = null
        return this.callOnce(name, args, false)
      }
      throw e
    }
    const body = await this.parseBody(res)
    if (body.error) {
      if (mayRetrySession && /session/i.test(body.error.message)) {
        this.session = null
        return this.callOnce(name, args, false)
      }
      // erro de validação de parâmetros etc.: não adianta repetir
      throw new SourceFailure('opgg', 'validation', `MCP ${body.error.code}: ${body.error.message.slice(0, 200)}`)
    }
    const text = body.result?.content?.find((c) => c.type === 'text')?.text
    if (body.result?.isError || typeof text !== 'string') {
      throw new SourceFailure('opgg', 'validation', 'resposta de ferramenta sem texto')
    }
    return text
  }
}
