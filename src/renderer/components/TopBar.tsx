import { useEffect, useState, type ReactElement } from 'react'
import { Database, Gamepad2, Loader2, Settings, TriangleAlert, Wifi } from 'lucide-react'
import { fmtAge } from '@core/format'
import type { RecommendationResult } from '@core/types'
import { Logo } from './icons'
import { Tip } from './Tip'
import { useApp, type Mode } from '../state/store'

const PHASE_LABEL: Record<string, string> = {
  None: 'Fora da fila',
  Lobby: 'No lobby',
  Matchmaking: 'Na fila',
  ReadyCheck: 'Partida encontrada',
  ChampSelect: 'Seleção de campeões',
  GameStart: 'Iniciando partida',
  InProgress: 'Partida em andamento',
  Reconnect: 'Reconectando à partida',
  WaitingForStats: 'Fim de partida',
  PreEndOfGame: 'Fim de partida',
  EndOfGame: 'Fim de partida',
  Unknown: 'Estado desconhecido'
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

type Tone = 'ok' | 'warn' | 'idle' | 'demo' | 'manual'
function connection(mode: Mode, lcu: ReturnType<typeof useApp>['state']['lcu']): { tone: Tone; label: string; detail: string | null; live: boolean } {
  if (mode === 'demo') return { tone: 'demo', label: 'Demonstração', detail: 'dados fictícios', live: false }
  const lcuText =
    lcu.state === 'connected'
      ? `Cliente conectado · ${PHASE_LABEL[lcu.phase] ?? lcu.phase}`
      : lcu.state === 'reconnecting'
        ? `Reconectando ao cliente… (tentativa ${lcu.attempt})`
        : lcu.state === 'connecting'
          ? 'Conectando ao cliente…'
          : 'Aguardando o cliente do LoL'
  if (mode === 'manual') return { tone: 'manual', label: 'Modo manual', detail: lcu.state === 'connected' ? 'cliente conectado' : null, live: false }
  if (lcu.state === 'connected') return { tone: 'ok', label: lcuText, detail: null, live: lcu.phase === 'ChampSelect' }
  return { tone: lcu.state === 'reconnecting' ? 'warn' : 'idle', label: lcuText, detail: null, live: false }
}

export function TopBar({ result }: { result: RecommendationResult }): ReactElement {
  const { state, dispatch } = useApp()
  const now = useNow(5000)
  const c = connection(state.mode, state.lcu)
  const lastEvent = state.mode === 'auto' && state.lcu.lastEventAt ? state.lcu.lastEventAt : null
  const prov = result.provenance
  const patch = prov?.patch ?? state.roster?.patch ?? null
  const mismatch = !!prov?.patch && !!prov.currentPatch && prov.patch !== prov.currentPatch
  const d = state.data
  const data =
    d.state === 'loading'
        ? { icon: <Loader2 size={14} className="spin" />, text: 'Carregando dados…', tone: 'idle' as const }
        : d.state === 'error'
          ? { icon: <TriangleAlert size={14} />, text: 'Dados indisponíveis', tone: 'error' as const }
          : d.progress && d.progress.done < d.progress.total
            ? { icon: <Loader2 size={14} className="spin" />, text: `Confrontos ${d.progress.done}/${d.progress.total}`, tone: 'idle' as const }
            : d.state === 'partial'
              ? { icon: <TriangleAlert size={14} />, text: 'Dados parciais', tone: 'warn' as const }
              : d.demo
                ? { icon: <Database size={14} />, text: 'Dados fictícios', tone: 'demo' as const }
                : d.state === 'ready'
                  ? { icon: <Database size={14} />, text: `${d.fromCache ? 'Cache' : 'OP.GG'}${d.lastUpdated ? ` · ${fmtAge(now - d.lastUpdated)}` : ''}`, tone: d.fromCache ? ('warn' as const) : ('idle' as const) }
                  : null

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span>LeagueSense</span>
      </div>

      <Tip text={lastEvent ? `Última atualização do cliente: ${new Date(lastEvent).toLocaleTimeString('pt-BR')}` : c.label} side="bottom">
        <div className="status-pill" data-tone={c.tone} role="status" aria-live="polite">
          <span className="dot" data-live={c.live || undefined} aria-hidden="true" />
          <span className="status-text">{c.label}</span>
          {c.detail && <span className="status-detail">· {c.detail}</span>}
          {lastEvent && state.lcu.state === 'connected' && <span className="status-detail">· {fmtAge(now - lastEvent)}</span>}
        </div>
      </Tip>

      <div className="spacer" />

      {patch && (
        <Tip text={mismatch ? `Estatísticas do patch ${prov!.patch}; o jogo está no ${prov!.currentPatch}.` : `Patch ${patch}`}>
          <span className="chip-static" data-tone={mismatch ? 'warn' : undefined}>
            {mismatch && <TriangleAlert size={13} aria-hidden="true" />}
            Patch {patch}
          </span>
        </Tip>
      )}
      {data && (
        <span className="chip-static" data-tone={data.tone === 'idle' ? undefined : data.tone}>
          {data.icon}
          {data.text}
        </span>
      )}

      <div className="seg" role="radiogroup" aria-label="Modo">
        {(
          [
            ['auto', 'Automático', <Wifi key="a" size={14} />],
            ['manual', 'Manual', <Gamepad2 key="m" size={14} />],
            ['demo', 'Demo', <Database key="d" size={14} />]
          ] as const
        ).map(([m, label, icon]) => (
          <button key={m} type="button" role="radio" aria-checked={state.mode === m} className="seg-btn" onClick={() => dispatch({ type: 'mode', mode: m })}>
            {icon}
            {label}
          </button>
        ))}
      </div>

      <Tip text="Configurações">
        <button type="button" className="icon-btn" aria-label="Abrir configurações" onClick={() => dispatch({ type: 'sheet', tab: 'prefs' })}>
          <Settings size={17} />
        </button>
      </Tip>
      <span className="titlebar-gap" aria-hidden="true" />
    </header>
  )
}
