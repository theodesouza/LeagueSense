import WebSocket from 'ws'
import type { LcuCredentials } from './credentials'
import { isTlsVerifyError, tlsOptions, type TlsMode } from './http'

export const SESSION_EVENT = 'OnJsonApiEvent_lol-champ-select_v1_session'
export const PHASE_EVENT = 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase'

export interface LcuEvent {
  event: string
  eventType: 'Create' | 'Update' | 'Delete' | string
  uri: string
  data: unknown
}

export interface LcuSocketLike {
  close(): void
}

export interface SocketHandlers {
  onOpen(): void
  onEvent(e: LcuEvent): void
  onClose(reason: string): void
}

/** Extrai eventos do protocolo WAMP simplificado do cliente: `[8, "OnJsonApiEvent_...", {data,eventType,uri}]`. */
export function parseWsMessage(raw: string): LcuEvent | null {
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(msg) || msg[0] !== 8 || typeof msg[1] !== 'string') return null
  const payload = msg[2] as { data?: unknown; eventType?: unknown; uri?: unknown } | undefined
  if (!payload || typeof payload !== 'object') return null
  return {
    event: msg[1],
    eventType: typeof payload.eventType === 'string' ? payload.eventType : 'Update',
    uri: typeof payload.uri === 'string' ? payload.uri : '',
    data: payload.data
  }
}

export function openLcuSocket(creds: LcuCredentials, handlers: SocketHandlers, mode: TlsMode = 'pinned'): LcuSocketLike {
  const auth = 'Basic ' + Buffer.from(`riot:${creds.password}`).toString('base64')
  const url = `${creds.scheme === 'https' ? 'wss' : 'ws'}://127.0.0.1:${creds.port}/`
  let closed = false
  let ws: WebSocket
  const connect = (m: TlsMode): void => {
    ws = new WebSocket(url, { headers: { Authorization: auth }, handshakeTimeout: 5000, ...(creds.scheme === 'https' ? tlsOptions(m) : {}) })
    ws.on('open', () => {
      ws.send(JSON.stringify([5, SESSION_EVENT]))
      ws.send(JSON.stringify([5, PHASE_EVENT]))
      handlers.onOpen()
    })
    ws.on('message', (data) => {
      const ev = parseWsMessage(data.toString())
      if (ev) handlers.onEvent(ev)
    })
    ws.on('close', (code) => {
      if (!closed) handlers.onClose(`código ${code}`)
    })
    ws.on('error', (err) => {
      if (closed) return
      if (m === 'pinned' && creds.scheme === 'https' && isTlsVerifyError(err)) {
        ws.removeAllListeners()
        connect('loopback-insecure')
        return
      }
      handlers.onClose(err.message)
    })
  }
  connect(mode)
  return {
    close() {
      closed = true
      try {
        ws.removeAllListeners()
        ws.on('error', () => undefined)
        ws.terminate()
      } catch {
        /* já fechado */
      }
    }
  }
}
