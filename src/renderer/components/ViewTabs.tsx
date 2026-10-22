import { useRef, useState, type ReactElement } from 'react'
import { ListOrdered, Map as MapIcon, Replace } from 'lucide-react'
import type { TraitsTable } from '@core/traits'
import type { Draft } from '@core/types'
import type { Focus, FocusSource } from '@core/focus'
import { MyChampionPicker } from './MyChampionPicker'
import { Portrait } from './Portrait'
import { useApp, type View } from '../state/store'

const SOURCE_LABEL: Record<FocusSource, string> = {
  travado: 'travado no cliente',
  escolhido: 'escolhido por você',
  provisorio: 'provisório no cliente',
  sugestao: 'melhor recomendação'
}

/** Abas "Recomendações | Plano de jogo" e o campeão em foco (com a troca pelo app). */
export function ViewTabs({ focus, draft, traits, planAvailable }: { focus: Focus | null; draft: Draft; traits: TraitsTable; planAvailable: boolean }): ReactElement {
  const { state, dispatch, champions, version } = useApp()
  const anchor = useRef<HTMLButtonElement | null>(null)
  const [el, setEl] = useState<HTMLElement | null>(null)
  const view: View = planAvailable ? state.view : 'recs'
  const champ = focus ? champions.get(focus.champion) : undefined
  const tabs: { id: View; label: string; icon: ReactElement }[] = [
    { id: 'recs', label: 'Recomendações', icon: <ListOrdered size={15} aria-hidden="true" /> },
    { id: 'plan', label: 'Plano de jogo', icon: <MapIcon size={15} aria-hidden="true" /> }
  ]
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    if (!planAvailable) return
    e.preventDefault()
    const next: View = view === 'recs' ? 'plan' : 'recs'
    dispatch({ type: 'view', view: next })
    requestAnimationFrame(() => document.getElementById(`view-tab-${next}`)?.focus())
  }
  return (
    <div className="viewbar">
      <div className="view-tabs" role="tablist" aria-label="Visão" onKeyDown={onKey}>
        {tabs.map((t) => {
          const disabled = t.id === 'plan' && !planAvailable
          return (
            <button key={t.id} type="button" role="tab" id={`view-tab-${t.id}`} aria-selected={view === t.id} aria-controls={`view-panel-${t.id}`} aria-disabled={disabled || undefined} tabIndex={view === t.id ? 0 : -1} className="view-tab" onClick={() => !disabled && dispatch({ type: 'view', view: t.id })} title={disabled ? 'Disponível quando houver uma posição e um draft' : undefined}>
              {t.icon}
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="spacer" />
      {planAvailable && (
        <div className="focus-chip">
          <Portrait champion={champ} version={version} size={26} />
          <span className="focus-text">
            <span className="focus-name">{champ?.name ?? 'Nenhum campeão'}</span>
            <span className="focus-src">{focus ? SOURCE_LABEL[focus.source] : 'escolha um campeão'}</span>
          </span>
          <button
            ref={anchor}
            type="button"
            className="btn ghost sm"
            aria-haspopup="dialog"
            aria-expanded={state.myPicker}
            onClick={(e) => {
              setEl(e.currentTarget)
              dispatch({ type: 'myPicker', open: !state.myPicker })
            }}
          >
            <Replace size={14} aria-hidden="true" />
            {focus ? 'Trocar campeão' : 'Escolher campeão'}
          </button>
          {state.myPicker && el && <MyChampionPicker anchor={el} draft={draft} traits={traits} current={state.myPick} onClose={() => dispatch({ type: 'myPicker', open: false })} />}
        </div>
      )}
    </div>
  )
}
