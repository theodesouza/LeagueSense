import type { SourceError, SourceName } from '@shared/api'

const LABEL: Record<SourceName, string> = {
  ddragon: 'Data Dragon (Riot)',
  opgg: 'OP.GG',
  lcu: 'cliente do League of Legends'
}

type Kind = SourceError['kind']

/** Erro de uma fonte externa, já com texto para o usuário. */
export class SourceFailure extends Error {
  readonly source: SourceName
  readonly kind: Kind
  readonly retryable: boolean
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined

  constructor(
    source: SourceName,
    kind: Kind,
    detail: string,
    opts: { status?: number; retryAfterMs?: number; cause?: unknown } = {}
  ) {
    super(detail, opts.cause ? { cause: opts.cause } : undefined)
    this.name = 'SourceFailure'
    this.source = source
    this.kind = kind
    this.status = opts.status
    this.retryAfterMs = opts.retryAfterMs
    this.retryable = kind === 'timeout' || kind === 'network' || kind === 'rate-limit' || (kind === 'http' && (opts.status ?? 0) >= 500)
  }
}

/** Texto em linguagem simples: o que houve e o que dá para fazer. Não inclui URLs com credenciais. */
export function describeFailure(source: SourceName, kind: Kind, status?: number): { message: string; action: string } {
  const who = LABEL[source]
  switch (kind) {
    case 'timeout':
      return {
        message: `O ${who} demorou demais para responder.`,
        action: 'Verifique sua conexão. Enquanto isso, o app usa os dados já guardados.'
      }
    case 'network':
      return {
        message: `Não foi possível conectar ao ${who}.`,
        action: 'Confira a internet, VPN ou firewall. O app tenta de novo sozinho.'
      }
    case 'rate-limit':
      return { message: `O ${who} pediu para diminuir o ritmo das consultas.`, action: 'Aguardando automaticamente; nada a fazer.' }
    case 'http':
      return {
        message: `O ${who} respondeu com erro${status ? ` (HTTP ${status})` : ''}.`,
        action: status && status >= 500 ? 'O serviço parece instável. Tente novamente em alguns minutos.' : 'O serviço pode ter mudado. Se persistir, atualize o LeagueSense.'
      }
    case 'parse':
    case 'validation':
      return {
        message: `O ${who} devolveu dados em um formato inesperado.`,
        action: 'Os dados guardados continuam valendo. Se persistir, o serviço pode ter mudado — atualize o LeagueSense.'
      }
    case 'unavailable':
      return { message: `O ${who} não está disponível.`, action: 'Abra o cliente do jogo ou use o modo manual.' }
  }
}

export function toSourceError(e: unknown, fallback: SourceName, now: number): SourceError {
  if (e instanceof SourceFailure) {
    const d = describeFailure(e.source, e.kind, e.status)
    return { source: e.source, kind: e.kind, message: d.message, action: d.action, at: now }
  }
  const d = describeFailure(fallback, 'network')
  return { source: fallback, kind: 'network', message: d.message, action: d.action, at: now }
}
