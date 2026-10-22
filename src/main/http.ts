import { SourceFailure } from './errors'
import type { SourceName } from '@shared/api'

export interface HttpOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  /** Tentativas extras após a primeira (padrão 2). */
  retries?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined
  const s = Number(h)
  if (Number.isFinite(s)) return Math.min(s, 30) * 1000
  return undefined
}

/**
 * fetch com tempo limite, novas tentativas (rede, timeout, 5xx, 429 com Retry-After) e erros
 * classificados. Nunca registra cabeçalhos nem corpo.
 */
export async function httpRequest(source: SourceName, url: string, opts: HttpOptions = {}): Promise<Response> {
  const f = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? 15_000
  let last: SourceFailure | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new SourceFailure(source, 'network', 'aborted')
    try {
      const timeout = AbortSignal.timeout(timeoutMs)
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
      const init: RequestInit = { method: opts.method ?? 'GET', signal }
      if (opts.headers) init.headers = opts.headers
      if (opts.body != null) init.body = opts.body
      const res = await f(url, init)
      if (res.ok) return res
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
      const kind = res.status === 429 ? 'rate-limit' : 'http'
      last = new SourceFailure(source, kind, `HTTP ${res.status}`, { status: res.status, ...(retryAfterMs != null ? { retryAfterMs } : {}) })
      await res.body?.cancel().catch(() => undefined)
      if (!last.retryable) throw last
    } catch (e) {
      if (e instanceof SourceFailure) {
        last = e
        if (!e.retryable) throw e
      } else if (opts.signal?.aborted) {
        throw new SourceFailure(source, 'network', 'aborted', { cause: e })
      } else if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        last = new SourceFailure(source, 'timeout', `timeout após ${timeoutMs} ms`, { cause: e })
      } else {
        last = new SourceFailure(source, 'network', e instanceof Error ? e.message : 'falha de rede', { cause: e })
      }
    }
    if (attempt < retries) {
      const backoff = last?.retryAfterMs ?? Math.round(400 * 2 ** attempt + Math.random() * 150)
      await sleep(backoff)
    }
  }
  throw last ?? new SourceFailure(source, 'network', 'falha desconhecida')
}

export async function httpJson<T>(source: SourceName, url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await httpRequest(source, url, opts)
  try {
    return (await res.json()) as T
  } catch (e) {
    throw new SourceFailure(source, 'parse', 'JSON inválido', { cause: e })
  }
}
