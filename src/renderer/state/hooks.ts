import { useEffect, useMemo, useRef, useState } from 'react'
import { emptyDraft, myDeclaredPosition, unavailableChampions } from '@core/draft'
import { recommend } from '@core/engine'
import { planFetches, type FetchPlan } from '@core/fetch-plan'
import type { TraitsTable } from '@core/traits'
import type { ChampionInfo, Draft, Position, RecommendationResult, StatsSnapshot } from '@core/types'
import { statsContextKey } from '@shared/channels'
import { applyStatsUpdate, initialStatsSync, type StatsSyncState } from '@shared/stats-sync'
import { api } from '../api'
import { buildDemoSteps } from './demo-script'
import type { Action, State } from './store'

export const demoSteps = buildDemoSteps()

/** Draft que a interface mostra, conforme o modo, já com as dicas de posição aplicadas. */
export function selectDraft(state: State): Draft {
  let d: Draft
  if (state.mode === 'manual') d = state.manualDraft
  else if (state.mode === 'demo') d = demoSteps[Math.min(state.demoStep, demoSteps.length - 1)]!.draft
  else d = state.lcuDraft.draft ?? emptyDraft('idle', 'lcu', 'idle')
  // "minha posição" escolhida vale também para o meu espaço
  if (state.prefs.position) {
    const mine = state.prefs.position
    d = { ...d, allies: d.allies.map((s) => (s.isMe && s.position !== mine ? { ...s, position: mine, positionSource: 'manual' as const } : s)) }
  }
  if (state.mode !== 'auto' || Object.keys(state.hints).length === 0) return d
  const apply = (slots: Draft['allies']): Draft['allies'] =>
    slots.map((s) => {
      const hint = s.champion != null ? state.hints[String(s.champion)] : undefined
      return hint && s.positionSource === 'none' ? { ...s, position: hint, positionSource: 'manual' as const } : s
    })
  return { ...d, allies: apply(d.allies), enemies: apply(d.enemies) }
}

export function selectPosition(state: State, draft: Draft): Position | null {
  return state.prefs.position ?? myDeclaredPosition(draft)
}

/** Assina eventos da ponte e carrega o estado inicial. */
export function useBridge(dispatch: React.Dispatch<Action>): void {
  useEffect(() => {
    let alive = true
    const offs: (() => void)[] = []
    void api.prefs.get().then((p) => alive && dispatch({ type: 'prefs', prefs: p }))
    void api.roster.get().then((r) => alive && dispatch({ type: 'roster', roster: r }))
    void api.lcu.status().then((s) => alive && dispatch({ type: 'lcu', status: s }))
    void api.lcu.currentDraft().then((u) => alive && dispatch({ type: 'lcuDraft', update: u }))
    void api.lcu.player().then((p) => alive && dispatch({ type: 'player', player: p }))
    offs.push(
      api.prefs.onChange((p) => dispatch({ type: 'prefs', prefs: p })),
      api.lcu.onStatus((s) => dispatch({ type: 'lcu', status: s })),
      api.lcu.onDraft((u) => dispatch({ type: 'lcuDraft', update: u })),
      api.lcu.onPlayer((p) => dispatch({ type: 'player', player: p })),
      api.stats.onStatus((d) => dispatch({ type: 'data', data: d }))
    )
    return () => {
      alive = false
      offs.forEach((o) => o())
    }
  }, [dispatch])
}

/** Instantâneo de estatísticas do contexto atual; descarta respostas de outro contexto ou antigas. */
export function useStatsSnapshot(contextKey: string | null): StatsSnapshot | null {
  const [sync, setSync] = useState<StatsSyncState>(initialStatsSync)
  const keyRef = useRef(contextKey)
  keyRef.current = contextKey
  useEffect(
    () =>
      api.stats.onUpdate((u) => {
        const key = keyRef.current
        if (key) setSync((prev) => applyStatsUpdate(prev, key, u))
      }),
    []
  )
  return contextKey && sync.contextKey === contextKey ? sync.snapshot : null
}

/** Pede ao processo principal os dados de que o motor precisa (com pequeno atraso para agrupar mudanças). */
export function useStatsRequest(args: {
  position: Position | null
  state: State
  draft: Draft
  snapshot: StatsSnapshot | null
  enabled: boolean
}): void {
  const { position, state, draft, snapshot, enabled } = args
  const mode = state.mode === 'demo' ? 'demo' : 'live'
  const lastPlan = useRef('')
  // dados de ordenação: usa a base atual se existir; senão pede só a lista inicial (meta)
  const base = snapshot?.baseDefault[position ?? 'mid']
  const roleRates = snapshot?.roleRates ?? {}
  const unavailableKey = [...unavailableChampions(draft)].sort().join(',')
  const allyKey = draft.allies.map((s) => `${s.champion}:${s.state}:${s.position}:${s.isMe}`).join('|')

  const plan: FetchPlan | null = useMemo(() => {
    if (!position) return null
    return planFetches({
      position,
      elo: state.prefs.elo,
      draft,
      prefs: state.prefs,
      base,
      roleRates,
      unavailable: unavailableChampions(draft)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, state.prefs.elo, state.prefs.pool, state.prefs.excluded, state.prefs.restrictToPool, base, unavailableKey, allyKey])

  const key = plan ? JSON.stringify([mode, plan]) : ''
  useEffect(() => {
    if (!enabled || !plan || key === lastPlan.current) return
    const t = setTimeout(() => {
      lastPlan.current = key
      void api.stats.request(plan, mode).catch(() => undefined)
    }, 200)
    return () => clearTimeout(t)
  }, [enabled, plan, key, mode])
}

export function contextKeyFor(mode: State['mode'], position: Position | null, elo: string): string | null {
  return position ? statsContextKey(mode === 'demo' ? 'demo' : 'opgg-mcp', position, elo) : null
}

/**
 * Enquanto as tabelas de confronto ainda estão chegando, adota instantâneos novos no máximo a cada
 * `ms`, para a lista não se reordenar a cada resposta (movimento excessivo). Fora do carregamento,
 * repassa na hora.
 */
export function useThrottledSnapshot(snapshot: StatsSnapshot | null, loading: boolean, ms = 1400): StatsSnapshot | null {
  const [shown, setShown] = useState(snapshot)
  const last = useRef(0)
  useEffect(() => {
    if (!loading || shown == null || snapshot == null) {
      setShown(snapshot)
      last.current = Date.now()
      return
    }
    const wait = Math.max(0, last.current + ms - Date.now())
    const t = setTimeout(() => {
      setShown(snapshot)
      last.current = Date.now()
    }, wait)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, loading, ms])
  return shown
}

export function useRecommendations(args: {
  draft: Draft
  position: Position | null
  stats: StatsSnapshot | null
  roster: ReadonlyMap<number, ChampionInfo>
  traits: TraitsTable
  state: State
}): RecommendationResult {
  const { draft, position, stats, roster, traits, state } = args
  const prev = useRef<number[]>([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const result = useMemo(
    () =>
      recommend({
        draft,
        position,
        stats,
        roster,
        traits,
        prefs: state.prefs,
        player: state.player,
        now,
        previousOrder: prev.current
      }),
    [draft, position, stats, roster, traits, state.prefs, state.player, now]
  )
  useEffect(() => {
    prev.current = result.ranking
  }, [result])
  return result
}
