import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from 'react'
import { MotionConfig } from 'motion/react'
import rosterJson from '@core/data/roster.json'
import traitsJson from '@core/data/traits.json'
import { myDeclaredPosition, type SlotRef } from '@core/draft'
import { resolveFocus } from '@core/focus'
import type { TraitsTable } from '@core/traits'
import type { ChampionInfo, Preferences } from '@core/types'
import { api } from './api'
import { ControlsBar } from './components/ControlsBar'
import { DemoBar } from './components/DemoBar'
import { DraftBoard, type Editable } from './components/DraftBoard'
import { SlotPopover } from './components/ChampionPicker'
import { PlanView } from './components/PlanView'
import { Banners, Recommendations } from './components/Recommendations'
import { ViewTabs } from './components/ViewTabs'
import { Sheet } from './components/Sheet'
import { TopBar } from './components/TopBar'
import { contextKeyFor, selectDraft, selectPosition, useBridge, useRecommendations, useStatsRequest, useStatsSnapshot, useThrottledSnapshot } from './state/hooks'
import { AppContext, initialState, reducer, type Ctx } from './state/store'

const bundled = rosterJson as unknown as { ddragonVersion: string; champions: ChampionInfo[] }
const traits = (traitsJson as unknown as { traits: TraitsTable }).traits

export function App(): ReactElement {
  const [state, dispatch] = useReducer(reducer, { ...initialState })
  useBridge(dispatch)

  const prefsRef = useRef<Preferences>(state.prefs)
  prefsRef.current = state.prefs
  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    const next = { ...prefsRef.current, ...patch }
    prefsRef.current = next
    dispatch({ type: 'prefs', prefs: next }) // otimista; a confirmação do processo principal chega por onChange
    void api.prefs.set(patch)
  }, [])

  const champions = useMemo(() => new Map((state.roster?.champions ?? bundled.champions).map((c) => [c.id, c])), [state.roster])
  const version = state.roster?.version ?? bundled.ddragonVersion

  const draft = useMemo(() => selectDraft(state), [state.mode, state.manualDraft, state.demoStep, state.lcuDraft, state.hints]) // eslint-disable-line react-hooks/exhaustive-deps
  const assigned = myDeclaredPosition(draft)
  const position = selectPosition(state, draft)
  const key = contextKeyFor(state.mode, position, state.prefs.elo)
  const snapshot = useStatsSnapshot(key)
  useStatsRequest({ position, state, draft, snapshot, enabled: state.prefsLoaded })
  const fetching = state.data.progress != null && state.data.progress.done < state.data.progress.total
  const shownStats = useThrottledSnapshot(snapshot, fetching)
  const result = useRecommendations({ draft, position, stats: shownStats, roster: champions, traits, state })

  // atributos globais para CSS (movimento e plataforma)
  useEffect(() => {
    document.documentElement.dataset['motion'] = state.prefs.motion
    document.documentElement.dataset['platform'] = (window as unknown as { leaguesensePlatform?: string }).leaguesensePlatform ?? 'web'
  }, [state.prefs.motion])

  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const openSlot = useCallback((ref: SlotRef, el: HTMLElement) => {
    setAnchor(el)
    dispatch({ type: 'picker', ref })
  }, [])
  const closeSlot = useCallback(() => dispatch({ type: 'picker', ref: null }), [])

  const standby = state.mode === 'auto' && !state.lcuDraft.draft ? (state.lcu.state === 'connected' ? 'idle' : 'waiting') : null
  const editable: Editable = state.mode === 'manual' ? 'full' : state.mode === 'auto' && !standby ? 'position' : 'none'
  const loading = !!position && snapshot == null && state.data.state !== 'error'

  const nameOf = useCallback((id: number) => champions.get(id)?.name ?? `Campeão ${id}`, [champions])
  const top = result.items[0]?.championId ?? null
  const focus = useMemo(() => resolveFocus({ draft, myPick: state.myPick, top, nameOf }), [draft, state.myPick, top, nameOf])
  const planAvailable = !!position && !standby
  const view = planAvailable ? state.view : 'recs'

  const ctx: Ctx = useMemo(() => ({ state, dispatch, champions, version, setPrefs }), [state, champions, version, setPrefs])
  const motion = state.prefs.motion === 'reduced' ? 'always' : state.prefs.motion === 'full' ? 'never' : 'user'

  return (
    <AppContext.Provider value={ctx}>
      <MotionConfig reducedMotion={motion}>
        <div className="app" data-mode={state.mode} data-view={view}>
          <TopBar result={result} />
          <main className="main">
            <DraftBoard draft={draft} editable={editable} onOpen={openSlot} activeRef={state.picker} />
            {state.mode === 'demo' && <DemoBar />}
            <ControlsBar position={position} assigned={assigned} />
            <ViewTabs focus={focus} draft={draft} traits={traits} planAvailable={planAvailable} />
            {view === 'plan' && position ? (
              <section className="recs view-fade" aria-label="Plano de jogo">
                <Banners result={result} mode={state.mode} />
                <div className="recs-scroll">
                  {focus ? (
                    <PlanView focus={focus} result={result} position={position} traits={traits} draft={draft} />
                  ) : (
                    <div className="state-card" id="view-panel-plan" role="tabpanel" aria-labelledby="view-tab-plan">
                      <div>
                        <h3>Escolha o seu campeão</h3>
                        <div className="state-body"><p>Ainda não há recomendação nem escolha. Use “Escolher campeão” para ver o plano de jogo de qualquer campeão.</p></div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <Recommendations result={result} position={position} traits={traits} standby={standby} loading={loading} focus={focus} />
            )}
          </main>
          <Sheet />
          {state.picker && anchor && <SlotPopover slotRef={state.picker} anchor={anchor} draft={draft} editable={editable} traits={traits} onClose={closeSlot} />}
        </div>
      </MotionConfig>
    </AppContext.Provider>
  )
}
