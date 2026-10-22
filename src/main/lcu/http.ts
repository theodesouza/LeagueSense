import { request as httpsRequest, Agent as HttpsAgent } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { LcuCredentials } from './credentials'
import { RIOT_LOCAL_CA } from './riot-ca'

export class LcuHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'LcuHttpError'
  }
}

/** Códigos de erro de TLS que indicam "certificado não confere com a CA da Riot". */
const TLS_VERIFY_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])
export const isTlsVerifyError = (e: unknown): boolean => TLS_VERIFY_CODES.has((e as NodeJS.ErrnoException | undefined)?.code ?? '')

export type TlsMode = 'pinned' | 'loopback-insecure'

export interface TlsOptions {
  ca?: string
  rejectUnauthorized: boolean
  checkServerIdentity?: () => undefined
}

/**
 * Validação de TLS do cliente local: primeiro contra a CA da Riot (ignorando o nome do host,
 * pois o destino é sempre 127.0.0.1). Se a cadeia não confere, cai para "loopback inseguro":
 * aceita o certificado SOMENTE para 127.0.0.1 (o token de autenticação continua exigido).
 */
export function tlsOptions(mode: TlsMode): TlsOptions {
  return mode === 'pinned'
    ? { ca: RIOT_LOCAL_CA, rejectUnauthorized: true, checkServerIdentity: () => undefined }
    : { rejectUnauthorized: false }
}

export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Lista fechada de escritas permitidas no cliente (conjuntos de itens, páginas de runas,
 * feitiços na seleção). Qualquer outra combinação método+caminho é recusada antes de sair do app.
 */
const WRITE_ALLOWLIST: { method: WriteMethod; path: RegExp }[] = [
  { method: 'PUT', path: /^\/lol-item-sets\/v1\/item-sets\/\d{1,20}\/sets$/ },
  { method: 'POST', path: /^\/lol-perks\/v1\/pages$/ },
  { method: 'PUT', path: /^\/lol-perks\/v1\/pages\/\d{1,12}$/ },
  { method: 'DELETE', path: /^\/lol-perks\/v1\/pages\/\d{1,12}$/ },
  { method: 'PUT', path: /^\/lol-perks\/v1\/currentpage$/ },
  { method: 'PATCH', path: /^\/lol-champ-select\/v1\/session\/my-selection$/ }
]
export const isWriteAllowed = (method: string, path: string): boolean => WRITE_ALLOWLIST.some((r) => r.method === method && r.path.test(path))

export interface LcuHttpLike {
  /** GET → JSON; 404 vira null (ex.: sem seleção de campeões ativa). */
  get<T = unknown>(path: string): Promise<T | null>
  /** Escrita restrita à lista fechada (`isWriteAllowed`). Erros HTTP, inclusive 404, viram exceção. */
  send<T = unknown>(method: WriteMethod, path: string, body?: unknown): Promise<T | null>
  readonly tlsMode: TlsMode
  close(): void
}

export class LcuHttp implements LcuHttpLike {
  tlsMode: TlsMode = 'pinned'
  private agents: Partial<Record<TlsMode, HttpsAgent>> = {}

  constructor(
    private readonly creds: LcuCredentials,
    private readonly timeoutMs = 4000
  ) {}

  private agent(mode: TlsMode): HttpsAgent {
    return (this.agents[mode] ??= new HttpsAgent({ keepAlive: true, ...tlsOptions(mode) }))
  }

  private once<T>(path: string, mode: TlsMode, method: 'GET' | WriteMethod = 'GET', body?: unknown): Promise<T | null> {
    const { port, password, scheme } = this.creds
    const auth = 'Basic ' + Buffer.from(`riot:${password}`).toString('base64')
    const payload = body === undefined ? null : JSON.stringify(body)
    return new Promise<T | null>((resolve, reject) => {
      const opts = {
        host: '127.0.0.1',
        port,
        path,
        method,
        timeout: this.timeoutMs,
        headers: { Authorization: auth, Accept: 'application/json', ...(payload != null ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}) },
        ...(scheme === 'https' ? { agent: this.agent(mode) } : {})
      }
      const req = (scheme === 'https' ? httpsRequest : httpRequest)(opts, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          if (status === 404 && method === 'GET') return resolve(null)
          if (status < 200 || status >= 300) return reject(new LcuHttpError(status, `HTTP ${status}`))
          const body = Buffer.concat(chunks).toString('utf8')
          if (!body) return resolve(null)
          try {
            resolve(JSON.parse(body) as T)
          } catch {
            reject(new LcuHttpError(status, 'JSON inválido'))
          }
        })
      })
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
      req.on('error', reject)
      req.end(payload ?? undefined)
    })
  }

  async get<T = unknown>(path: string): Promise<T | null> {
    try {
      return await this.once<T>(path, this.tlsMode)
    } catch (e) {
      if (this.creds.scheme === 'https' && this.tlsMode === 'pinned' && isTlsVerifyError(e)) {
        this.tlsMode = 'loopback-insecure'
        return this.once<T>(path, this.tlsMode)
      }
      throw e
    }
  }

  async send<T = unknown>(method: WriteMethod, path: string, body?: unknown): Promise<T | null> {
    if (!isWriteAllowed(method, path)) throw new LcuHttpError(0, `escrita não permitida: ${method} ${path}`)
    try {
      return await this.once<T>(path, this.tlsMode, method, body)
    } catch (e) {
      if (this.creds.scheme === 'https' && this.tlsMode === 'pinned' && isTlsVerifyError(e)) {
        this.tlsMode = 'loopback-insecure'
        return this.once<T>(path, this.tlsMode, method, body)
      }
      throw e
    }
  }

  close(): void {
    for (const a of Object.values(this.agents)) a?.destroy()
  }
}
