import { useEffect, type ReactElement } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useApp } from '../state/store'
import { demoSteps } from '../state/hooks'

/** Controle da seleção de exemplo (só no modo demonstração). */
export function DemoBar(): ReactElement {
  const { state, dispatch } = useApp()
  const last = demoSteps.length - 1
  useEffect(() => {
    if (!state.demoPlaying) return
    if (state.demoStep >= last) {
      dispatch({ type: 'demoPlaying', playing: false })
      return
    }
    const t = setTimeout(() => dispatch({ type: 'demoStep', step: state.demoStep + 1 }), 2600)
    return () => clearTimeout(t)
  }, [state.demoPlaying, state.demoStep, last, dispatch])
  return (
    <div className="demobar" role="group" aria-label="Controle da demonstração">
      <button type="button" className="icon-btn" aria-label="Passo anterior" disabled={state.demoStep === 0} onClick={() => dispatch({ type: 'demoStep', step: state.demoStep - 1 })}><SkipBack size={16} /></button>
      <button type="button" className="btn ghost sm" aria-pressed={state.demoPlaying} onClick={() => dispatch({ type: 'demoPlaying', playing: !state.demoPlaying })}>
        {state.demoPlaying ? <><Pause size={14} />Pausar</> : <><Play size={14} />Reproduzir</>}
      </button>
      <button type="button" className="icon-btn" aria-label="Próximo passo" disabled={state.demoStep >= last} onClick={() => dispatch({ type: 'demoStep', step: state.demoStep + 1 })}><SkipForward size={16} /></button>
      <span className="demo-step" aria-live="off">Passo {state.demoStep + 1}/{demoSteps.length} · {demoSteps[state.demoStep]?.label}</span>
    </div>
  )
}
