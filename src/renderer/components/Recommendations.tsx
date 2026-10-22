import { useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { CircleAlert, CircleCheck, CloudOff, Database, FlaskConical, Gamepad2, Hourglass, Info, PlugZap, RefreshCw, TriangleAlert, ChevronDown, Pencil } from 'lucide-react'
import { POSITIONS, POSITION_LABEL, type ChampionInfo, type DataQuality, type Position, type Recommendation, type RecommendationResult } from '@core/types'
import type { TraitsTable } from '@core/traits'
import { fmtSignedPp } from '@core/format'
import { api } from '../api'
import { useApp, type Mode } from '../state/store'
import { Details, provenanceLine } from './Details'
import { KindIcon, PositionIcon } from './icons'
import { Portrait, SplashArt } from './Portrait'
import { ScoreMeter } from './Score'

const TAG_PT: Record<string, string> = { Fighter: 'Lutador', Tank: 'Tanque', Mage: 'Mago', Assassin: 'Assassino', Marksman: 'Atirador', Support: 'Suporte' }
const QUALITY: Record<DataQuality, { label: string; icon: ReactNode }> = {
  ok: { label: 'Dados suficientes', icon: <CircleCheck size={13} /> },
  partial: { label: 'Dados parciais', icon: <TriangleAlert size={13} /> },
  insufficient: { label: 'Dados insuficientes', icon: <CircleAlert size={13} /> }
}

const ease = [0.2, 0.7, 0.2, 1] as const

function QualityChip({ q }: { q: DataQuality }): ReactElement {
  return (
    <span className="quality" data-q={q}>
      {QUALITY[q].icon}
      {QUALITY[q].label}
    </span>
  )
}

function Reasons({ rec, max }: { rec: Recommendation; max?: number }): ReactElement {
  const list = max ? rec.reasons.slice(0, max) : rec.reasons
  if (list.length === 0) return <p className="muted small">Sem diferencial forte nos fatores analisados — opção neutra.</p>
  return (
    <ul className="reasons">
      {list.map((f, i) => (
        <li key={`${f.kind}-${i}`}>
          <KindIcon kind={f.kind} />
          <span>{f.text}</span>
          <span className="pp tabular" aria-label={`${fmtSignedPp(f.pp)} pontos percentuais equivalentes`}>{fmtSignedPp(f.pp)}</span>
        </li>
      ))}
    </ul>
  )
}

function Risk({ rec }: { rec: Recommendation }): ReactElement {
  return rec.risk ? (
    <p className="risk" data-has>
      <TriangleAlert size={15} aria-hidden="true" />
      <span><strong>Risco:</strong> {rec.risk.text}</span>
    </p>
  ) : (
    <p className="risk muted">
      <CircleCheck size={15} aria-hidden="true" />
      <span>Nenhuma desvantagem relevante nos fatores analisados.</span>
    </p>
  )
}

function Hero({ rec, champion, version, position, result, expanded, onToggle, champions }: {
  rec: Recommendation
  champion: ChampionInfo | undefined
  version: string
  position: Position | null
  result: RecommendationResult
  expanded: boolean
  onToggle: () => void
  champions: ReadonlyMap<number, ChampionInfo>
}): ReactElement {
  const id = useId()
  return (
    <motion.article
      key={rec.championId}
      className="hero"
      aria-label={`Melhor opção: ${champion?.name ?? rec.championId}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease }}
    >
      <SplashArt champion={champion} version={version} />
      <div className="hero-body">
        <div className="hero-kicker"><span className="rank-1">1</span> {result.status === 'no-stats' ? 'Sugestão sem estatísticas' : 'Melhor opção agora'}</div>
        <h2 className="hero-name">{champion?.name ?? `Campeão ${rec.championId}`}</h2>
        <div className="hero-tags">
          {position && <span className="tag"><PositionIcon position={position} size={13} />{POSITION_LABEL[position]}</span>}
          {champion?.tags.map((t) => TAG_PT[t] ?? t).filter((t) => !position || t !== POSITION_LABEL[position]).slice(0, 2).map((t) => <span className="tag" key={t}>{t}</span>)}
          <QualityChip q={rec.quality} />
        </div>
        <ScoreMeter value={rec.score} />
        <Reasons rec={rec} />
        <Risk rec={rec} />
        <p className="prov small"><Info size={13} aria-hidden="true" />{provenanceLine(result.provenance, rec, position)}</p>
        <button type="button" className="btn ghost sm" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
          {expanded ? 'Ocultar cálculo' : 'Ver como foi calculado'}
          <ChevronDown size={14} className="chev" data-open={expanded || undefined} />
        </button>
      </div>
      <div id={id} className="hero-details">
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }} style={{ overflow: 'hidden' }}>
              <Details rec={rec} provenance={result.provenance} position={position} champions={champions} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  )
}

function Row({ rec, rank, champion, version, position, result, expanded, onToggle, champions }: {
  rec: Recommendation
  rank: number
  champion: ChampionInfo | undefined
  version: string
  position: Position | null
  result: RecommendationResult
  expanded: boolean
  onToggle: () => void
  champions: ReadonlyMap<number, ChampionInfo>
}): ReactElement {
  const id = useId()
  const first = rec.reasons[0]
  return (
    <motion.li
      layout="position"
      className="row"
      data-expanded={expanded || undefined}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease, layout: { duration: 0.26, ease: [0.4, 0, 0.2, 1] } }}
    >
      <button type="button" className="row-main" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
        <span className="rank">{rank}</span>
        <Portrait champion={champion} version={version} size={44} />
        <span className="row-id">
          <span className="row-name">{champion?.name ?? rec.championId}</span>
          <span className="row-sub"><QualityChip q={rec.quality} /></span>
        </span>
        <span className="row-reason">
          {first ? <><KindIcon kind={first.kind} /><span>{first.text}</span></> : <span className="muted">Sem diferencial forte</span>}
        </span>
        <ScoreMeter value={rec.score} size="sm" />
        <ChevronDown size={16} className="chev" data-open={expanded || undefined} aria-hidden="true" />
      </button>
      <div id={id}>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }} style={{ overflow: 'hidden' }}>
              <div className="row-expanded">
                <Risk rec={rec} />
                <Details rec={rec} provenance={result.provenance} position={position} champions={champions} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  )
}

/* ---------------------------- estados ---------------------------- */

function StateCard({ icon, title, children, actions, tone }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; tone?: 'warn' | 'danger' }): ReactElement {
  return (
    <motion.div className="state-card" data-tone={tone} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease }}>
      <span className="state-icon" aria-hidden="true">{icon}</span>
      <div>
        <h3>{title}</h3>
        {children && <div className="state-body">{children}</div>}
        {actions && <div className="state-actions">{actions}</div>}
      </div>
    </motion.div>
  )
}

function Skeleton(): ReactElement {
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">Carregando recomendações…</span>
      <div className="sk-hero" />
      <div className="sk-rows">{[0, 1, 2, 3].map((i) => <div key={i} className="sk-row" />)}</div>
    </div>
  )
}

export function Standby({ kind }: { kind: 'waiting' | 'idle' }): ReactElement {
  const { state, dispatch } = useApp()
  const phase = state.lcu.phase
  return kind === 'waiting' ? (
    <StateCard icon={<Hourglass size={22} />} title="Aguardando o cliente do League of Legends" actions={
      <>
        <button type="button" className="btn primary" onClick={() => dispatch({ type: 'mode', mode: 'manual' })}><Gamepad2 size={15} />Preencher manualmente</button>
        <button type="button" className="btn ghost" onClick={() => void api.lcu.reconnect()}><RefreshCw size={15} />Procurar de novo</button>
        <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'mode', mode: 'demo' })}><FlaskConical size={15} />Ver demonstração</button>
      </>
    }>
      <p>Abra o cliente e entre em uma fila. O LeagueSense detecta a seleção de campeões sozinho e mostra as recomendações assim que ela começar.</p>
      <p className="muted small">Sem o cliente aberto você ainda pode simular um draft no modo manual.</p>
    </StateCard>
  ) : (
    <StateCard icon={<PlugZap size={22} />} title="Cliente conectado — fora da seleção de campeões" actions={
      <>
        <button type="button" className="btn primary" onClick={() => dispatch({ type: 'mode', mode: 'manual' })}><Pencil size={15} />Preencher manualmente</button>
        <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'mode', mode: 'demo' })}><FlaskConical size={15} />Ver demonstração</button>
      </>
    }>
      <p>Estado atual do cliente: <strong>{phase === 'Lobby' ? 'no lobby' : phase === 'Matchmaking' ? 'na fila' : phase === 'ReadyCheck' ? 'partida encontrada' : phase === 'InProgress' ? 'partida em andamento' : phase === 'None' ? 'fora da fila' : phase}</strong>. As recomendações aparecem quando a seleção de campeões começar.</p>
    </StateCard>
  )
}

/* ----------------------------- lista ----------------------------- */

interface Props {
  result: RecommendationResult
  position: Position | null
  traits: TraitsTable
  standby: 'waiting' | 'idle' | null
  loading: boolean
}

export function Recommendations({ result, position, standby, loading }: Props): ReactElement {
  const { state, dispatch, champions, version, setPrefs } = useApp()
  const items = result.items
  const announce = useMemo(() => (items.length ? `Recomendações atualizadas: ${items.map((i, n) => `${n + 1}, ${champions.get(i.championId)?.name ?? i.championId}`).join('; ')}.` : ''), [items, champions])
  const [live, setLive] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setLive(announce), 900)
    return () => clearTimeout(t)
  }, [announce])

  const toggle = (id: number): void => dispatch({ type: 'expand', id })
  let body: ReactNode
  let bodyKey = 'list'

  if (standby) {
    bodyKey = `standby-${standby}`
    body = <Standby kind={standby} />
  }
  else if (!position) {
    bodyKey = 'no-position'
    body = (
      <StateCard icon={<Info size={22} />} title="Escolha sua posição" actions={
        <div className="seg positions" role="group" aria-label="Escolher posição">
          {POSITIONS.map((p) => (
            <button key={p} type="button" className="seg-btn" aria-label={POSITION_LABEL[p]} onClick={() => setPrefs({ position: p })}><PositionIcon position={p} size={16} /><span>{POSITION_LABEL[p]}</span></button>
          ))}
        </div>
      }>
        <p>O cliente não informou sua posição (comum em filas sem posição atribuída). Diga em qual rota você vai jogar para ver as recomendações.</p>
      </StateCard>
    )
  } else if (items.length === 0 && (loading || state.data.state === 'idle' || state.data.state === 'loading') && !result.provenance) {
    bodyKey = 'skeleton'
    body = <Skeleton />
  } else if (items.length === 0 && state.data.state === 'error') {
    bodyKey = 'error'
    const err = state.data.errors[0]
    body = (
      <StateCard tone="danger" icon={<CloudOff size={22} />} title="Estatísticas indisponíveis no momento" actions={
        <>
          <button type="button" className="btn primary" onClick={() => void api.stats.refresh().then(() => dispatch({ type: 'mode', mode: state.mode }))}><RefreshCw size={15} />Tentar de novo</button>
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'mode', mode: 'demo' })}><FlaskConical size={15} />Ver demonstração</button>
        </>
      }>
        <p>{err?.message ?? 'O serviço de estatísticas não respondeu.'}</p>
        <p className="muted small">{err?.action ?? 'Verifique sua conexão e tente novamente.'}</p>
      </StateCard>
    )
  } else if (items.length === 0) {
    bodyKey = 'empty'
    body = (
      <StateCard tone="warn" icon={<Database size={22} />} title="Poucas recomendações para esses filtros" actions={
        <>
          {state.prefs.restrictToPool && <button type="button" className="btn primary" onClick={() => setPrefs({ restrictToPool: false })}>Mostrar além da minha pool</button>}
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'sheet', tab: 'pool' })}>Revisar minha pool</button>
        </>
      }>
        <p>{result.excludedCount > 0 ? `${result.excludedCount} campeões foram excluídos por bans, escolhas já feitas, posse ou suas exclusões.` : 'Nenhum campeão com dados suficientes nesta posição.'}</p>
      </StateCard>
    )
  } else {
    const [top, ...rest] = items
    body = (
      <LayoutGroup>
        <div className="rec-grid">
          <div className="rec-hero-col">
            <AnimatePresence mode="wait" initial={false}>
              <Hero key={top!.championId} rec={top!} champion={champions.get(top!.championId)} version={version} position={position} result={result} expanded={state.expanded === top!.championId} onToggle={() => toggle(top!.championId)} champions={champions} />
            </AnimatePresence>
          </div>
          <ol className="rec-list" aria-label="Outras opções">
            <AnimatePresence initial={false} mode="popLayout">
              {rest.map((r, i) => (
                <Row key={r.championId} rec={r} rank={i + 2} champion={champions.get(r.championId)} version={version} position={position} result={result} expanded={state.expanded === r.championId} onToggle={() => toggle(r.championId)} champions={champions} />
              ))}
            </AnimatePresence>
          </ol>
        </div>
      </LayoutGroup>
    )
  }

  return (
    <section className="recs" aria-label="Recomendações">
      <Banners result={result} mode={state.mode} />
      <div className="recs-scroll">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={bodyKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}>
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
      <p className="sr-only" aria-live="polite">{live}</p>
    </section>
  )
}

/* ----------------------------- avisos ----------------------------- */

interface BannerItem {
  id: string
  tone: 'demo' | 'info' | 'warn' | 'danger'
  icon: ReactNode
  text: ReactNode
  action?: { label: string; run: () => void }
}

function Banners({ result, mode }: { result: RecommendationResult; mode: Mode }): ReactElement | null {
  const { state, dispatch } = useApp()
  const items: BannerItem[] = []
  if (mode === 'demo') items.push({ id: 'demo', tone: 'demo', icon: <FlaskConical size={15} />, text: <><strong>Modo demonstração.</strong> Todos os números e campeões escolhidos são fictícios — não use para decidir uma partida real.</>, action: { label: 'Sair da demonstração', run: () => dispatch({ type: 'mode', mode: 'auto' }) } })
  if (mode === 'manual') items.push({ id: 'manual', tone: 'info', icon: <Gamepad2 size={15} />, text: <><strong>Modo manual.</strong> Clique em um espaço do draft para preencher ou corrigir. {state.lcu.state === 'connected' && state.lcu.phase === 'ChampSelect' ? 'O cliente está em seleção de campeões.' : ''}</>, action: { label: 'Voltar ao automático', run: () => dispatch({ type: 'mode', mode: 'auto' }) } })
  if (mode !== 'demo') {
    for (const e of state.data.errors.slice(0, 2)) {
      if (result.items.length === 0 && state.data.state === 'error') break
      items.push({ id: `err-${e.kind}-${e.message}`, tone: 'warn', icon: <CloudOff size={15} />, text: <>{e.message} <span className="muted">{e.action}</span></>, action: { label: 'Tentar de novo', run: () => void api.stats.refresh() } })
    }
    for (const w of result.warnings) {
      items.push({ id: `w-${w.kind}`, tone: w.kind === 'no-stats' ? 'danger' : 'warn', icon: <TriangleAlert size={15} />, text: w.text })
    }
    if (state.data.fromCache && state.data.state !== 'error' && !result.warnings.some((w) => w.kind === 'stale')) {
      items.push({ id: 'cache', tone: 'info', icon: <Database size={15} />, text: 'Usando estatísticas guardadas no computador (cache).' })
    }
  }
  if (items.length === 0) return null
  return (
    <div className="banners">
      <AnimatePresence initial={false}>
        {items.map((b) => (
          <motion.div key={b.id} className="banner" data-tone={b.tone} role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}>
            <div className="banner-inner">
              <span aria-hidden="true">{b.icon}</span>
              <span className="banner-text">{b.text}</span>
              {b.action && <button type="button" className="link-btn" onClick={b.action.run}>{b.action.label}</button>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
