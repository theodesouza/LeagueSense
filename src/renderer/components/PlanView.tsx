import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { ChartColumn, CircleAlert, CircleCheck, CloudOff, Lightbulb, RefreshCw, ShieldAlert, Swords, TriangleAlert, Users } from 'lucide-react'
import type { BuildId, MatchupAdvice, MatchupLine, TeamSummary } from '@core/build-types'
import { planGame } from '@core/builds'
import { membersOf, type Focus } from '@core/focus'
import { fmtInt, fmtPct, fmtPct0 } from '@core/format'
import { traitsFor, type TraitsTable } from '@core/traits'
import { POSITION_LABEL, type Draft, type Position, type RecommendationResult } from '@core/types'
import { useBuildBundle } from '../state/hooks'
import { useApp } from '../state/store'
import { BuildPanel } from './BuildPanel'
import { ItemIcon } from './GameIcons'
import { Portrait } from './Portrait'

const VERDICT: Record<MatchupAdvice['verdict'], { label: string; tone: 'good' | 'bad' | 'neutral' }> = {
  favoravel: { label: 'Confronto favorável', tone: 'good' },
  equilibrado: { label: 'Confronto equilibrado', tone: 'neutral' },
  desfavoravel: { label: 'Confronto desfavorável', tone: 'bad' },
  'sem-dados': { label: 'Sem dados do confronto', tone: 'neutral' }
}

const LINE_ICON: Record<MatchupLine['kind'], ReactNode> = {
  estatistica: <ChartColumn size={15} />,
  estilo: <Swords size={15} />,
  heuristica: <Lightbulb size={15} />,
  riot: <ShieldAlert size={15} />,
  opgg: <Lightbulb size={15} />
}
const KIND_TAG: Record<MatchupLine['kind'], string> = { estatistica: 'dado', estilo: 'dado', heuristica: 'regra', riot: 'oficial', opgg: 'terceiros' }


function MatchupCard({ advice, opponentName, champion, version, opponent }: { advice: MatchupAdvice; opponentName: string; champion: number; version: string; opponent: number }): ReactElement {
  const { champions } = useApp()
  const v = VERDICT[advice.verdict]
  return (
    <section className="mu" aria-labelledby="mu-title">
      <header className="mu-head">
        <div className="mu-vs" aria-hidden="true">
          <Portrait champion={champions.get(champion)} version={version} size={36} />
          <span>vs</span>
          <Portrait champion={champions.get(opponent)} version={version} size={36} />
        </div>
        <div className="mu-title">
          <h3 id="mu-title">Dica de confronto: {opponentName}</h3>
          <p className="muted small">Oponente de rota mais provável ({Math.round(advice.probability * 100)}% de chance)</p>
        </div>
        <span className="verdict" data-tone={v.tone}>{v.label}</span>
      </header>
      <p className="mu-headline">{advice.headline}</p>
      {advice.record && (
        <p className="small muted tabular">Histórico do confronto: {fmtInt(advice.record.play)} partidas · {fmtPct(advice.record.winRate)} de vitórias para o seu campeão.</p>
      )}
      <ul className="mu-lines">
        {advice.lines.map((l, i) => (
          <li key={i}>
            <span className="mu-icon" data-kind={l.kind} aria-hidden="true">{LINE_ICON[l.kind]}</span>
            <span className="mu-text">
              {l.text}
              <span className="src-tag"><span className="src-kind">{l.source.startsWith('demonstração') ? 'fictício' : KIND_TAG[l.kind]}</span>{l.source}</span>
            </span>
          </li>
        ))}
      </ul>
      {advice.uncertainty && <p className="mu-unc small"><TriangleAlert size={14} aria-hidden="true" />{advice.uncertainty}</p>}
    </section>
  )
}

function descTeam(t: TeamSummary['allies'] | TeamSummary['enemies'], kind: 'ally' | 'enemy'): string[] {
  const out: string[] = []
  if (t.physical != null) out.push(`${fmtPct0(t.physical)} do dano é físico`)
  out.push(t.frontline >= 2 ? 'linha de frente forte' : t.frontline >= 1 ? 'alguma linha de frente' : 'sem linha de frente')
  if (kind === 'enemy') {
    const e = t as TeamSummary['enemies']
    if (e.cc >= 2) out.push('muito controle de grupo')
    if (e.dive >= 1.5) out.push('muito mergulho')
    if (e.sustain >= 1) out.push('cura relevante')
  } else {
    const a = t as TeamSummary['allies']
    if (a.engage >= 1.5) out.push('bom engajamento')
    if (a.peel >= 1.5) out.push('boa proteção')
  }
  return out
}

function Team({ summary }: { summary: TeamSummary }): ReactElement | null {
  if (summary.allies.count === 0 && summary.enemies.count === 0) return null
  return (
    <section className="team" aria-label="Resumo dos times">
      {summary.enemies.count > 0 && (
        <div className="team-row" data-side="enemy">
          <span className="kicker"><Users size={13} aria-hidden="true" />Time inimigo ({summary.enemies.count})</span>
          <span>{descTeam(summary.enemies, 'enemy').join(' · ')}</span>
        </div>
      )}
      {summary.allies.count > 0 && (
        <div className="team-row" data-side="ally">
          <span className="kicker"><Users size={13} aria-hidden="true" />Seu time ({summary.allies.count})</span>
          <span>{descTeam(summary.allies, 'ally').join(' · ')}</span>
        </div>
      )}
    </section>
  )
}

function SkeletonPlan(): ReactElement {
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">Montando o plano de jogo…</span>
      <div className="sk-hero" />
      <div className="sk-rows">{[0, 1, 2].map((i) => <div key={i} className="sk-row" />)}</div>
    </div>
  )
}

/** Plano de jogo do campeão em foco: dica de confronto, três builds e o que fazer com cada uma. */
export function PlanView({ focus, result, position, traits, draft }: { focus: Focus; result: RecommendationResult; position: Position; traits: TraitsTable; draft: Draft }): ReactElement {
  const { state, champions, version } = useApp()
  const mode = state.mode === 'demo' ? 'demo' : 'live'
  const champ = champions.get(focus.champion)
  const opponent = result.laneOpponentDistribution[0] ?? null
  const data = useBuildBundle({ champion: focus.champion, position, elo: state.prefs.elo, opponent: opponent?.champion ?? null, mode, enabled: true })
  const nameOf = useCallback((id: number) => champions.get(id)?.name ?? `Campeão ${id}`, [champions])
  const traitsOf = useCallback((id: number) => traitsFor(traits, id, champions.get(id)?.tags), [traits, champions])
  const [picked, setPicked] = useState<{ champion: number; id: BuildId } | null>(null)

  const plan = useMemo(() => {
    const b = data.bundle
    if (!b || b.champion !== focus.champion || b.position !== position) return null
    // o pacote pode ser de um oponente anterior (novo ainda carregando): nesse caso não usa o guia dele
    const bundle = b.opponent === (opponent?.champion ?? null) ? b : { ...b, opponent: opponent?.champion ?? null, guide: null, opponentTips: [] }
    const { allies, enemies } = membersOf(draft, traitsOf)
    return planGame({ champion: focus.champion, position, nameOf, traitsOf, tagsOf: (id) => champions.get(id)?.tags, allies, enemies, bundle, opponent })
  }, [data.bundle, focus.champion, position, opponent?.champion, opponent?.probability, draft, nameOf, traitsOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const builds = plan?.builds ?? []
  const wanted = picked && picked.champion === focus.champion ? picked.id : null
  const current = builds.find((b) => b.id === wanted) ?? builds.find((b) => b.id === 'adaptada') ?? builds[0]
  const bundle = data.bundle && data.bundle.champion === focus.champion ? data.bundle : null
  const refreshing = data.status === 'loading' && plan != null
  const inUse = state.use && state.use.champion === focus.champion ? state.use : null

  let body: ReactNode
  if (!plan && data.status === 'error') {
    body = (
      <div className="state-card" data-tone="danger">
        <span className="state-icon" aria-hidden="true"><CloudOff size={22} /></span>
        <div>
          <h3>Não foi possível montar o plano agora</h3>
          <div className="state-body"><p>O serviço de builds não respondeu. Seus dados guardados continuam valendo, mas ainda não há nada em cache para este campeão.</p></div>
          <div className="state-actions"><button type="button" className="btn primary" onClick={data.retry}><RefreshCw size={15} />Tentar de novo</button></div>
        </div>
      </div>
    )
  } else if (!plan) {
    body = <SkeletonPlan />
  } else {
    body = (
      <>
        {focus.note && <p className="plan-note" role="status"><CircleAlert size={15} aria-hidden="true" />{focus.note}</p>}
        {bundle?.problems.map((p, i) => (
          <p className="plan-note" data-tone="warn" key={i} role="status"><TriangleAlert size={15} aria-hidden="true" /><span>{p.message} {p.action && <span className="muted">{p.action}</span>}</span></p>
        ))}
        {plan.warnings.map((w, i) => (
          <p className="plan-note" key={`w${i}`} role="status"><CircleAlert size={15} aria-hidden="true" />{w}</p>
        ))}
        {plan.matchup && opponent && <MatchupCard advice={plan.matchup} opponentName={nameOf(opponent.champion)} champion={focus.champion} opponent={opponent.champion} version={version} />}
        {!plan.matchup && <p className="plan-note"><CircleAlert size={15} aria-hidden="true" />Ainda não há um oponente de rota provável: a dica de confronto aparece quando algum inimigo for escolhido.</p>}
        <Team summary={plan.team} />

        {builds.length > 0 && current && (
          <>
            <div className="build-pick" role="radiogroup" aria-label="Escolha uma das builds">
              {builds.map((b) => {
                const selected = b.id === current.id
                const used = inUse?.build === b.id
                const core = b.items.filter((i) => i.role === 'principal')
                return (
                  <button key={b.id} type="button" role="radio" aria-checked={selected} className="build-card" data-selected={selected || undefined} onClick={() => setPicked({ champion: focus.champion, id: b.id })}>
                    <span className="build-card-top">
                      <span className="build-card-title">{b.title}</span>
                      {used && <span className="used-badge"><CircleCheck size={12} aria-hidden="true" />Em uso</span>}
                    </span>
                    <span className="build-card-sub">{b.subtitle}</span>
                    <span className="build-card-items" aria-hidden="true">
                      {core.map((i) => <ItemIcon key={i.id} id={i.id} name={i.name} version={bundle?.catalog?.version ?? version} size={30} />)}
                    </span>
                    <span className="sr-only">Itens principais: {core.map((i) => i.name).join(', ')}.</span>
                    <span className="build-card-ev small">
                      {b.evidence.play != null ? `${fmtInt(b.evidence.play)} partidas${b.evidence.winRate != null ? ` · ${fmtPct(b.evidence.winRate)}` : ''}` : 'sem amostra'}
                    </span>
                  </button>
                )
              })}
            </div>
            <BuildPanel key={`${focus.champion}-${current.id}`} build={current} champion={focus.champion} catalog={bundle?.catalog ?? null} version={version} />
          </>
        )}
        {bundle && (
          <p className="prov small plan-prov">
            {bundle.provenance.source === 'demo'
              ? 'DADOS FICTÍCIOS de demonstração — não refletem o jogo real.'
              : [
                  'Fonte: OP.GG (builds) e Data Dragon (itens, runas, dicas oficiais)',
                  bundle.provenance.patch ? `patch ${bundle.provenance.patch}` : 'patch não informado',
                  `builds: ${bundle.provenance.tier}`,
                  bundle.guide ? `confronto: agregado ${bundle.provenance.guideTier} (sem filtro de elo)` : null,
                  bundle.provenance.fromCache ? 'em cache' : null
                ].filter(Boolean).join(' · ')}
          </p>
        )}
      </>
    )
  }

  return (
    <section className="plan" id="view-panel-plan" role="tabpanel" aria-labelledby="view-tab-plan" aria-busy={refreshing || undefined}>
      <header className="plan-head">
        <Portrait champion={champ} version={version} size={56} />
        <div className="plan-head-text">
          <p className="kicker">Plano de jogo · {POSITION_LABEL[position]}</p>
          <h2>{champ?.name ?? `Campeão ${focus.champion}`}</h2>
        </div>
        {refreshing && <span className="refreshing small muted" role="status"><RefreshCw size={13} className="spin" aria-hidden="true" />Atualizando…</span>}
      </header>
      {body}
    </section>
  )
}
