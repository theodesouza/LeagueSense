import type { ReactElement } from 'react'
import { Users } from 'lucide-react'
import { ELO_LABEL } from '@core/format'
import { ELO_TIERS, POSITIONS, POSITION_LABEL, type EloTier, type Position } from '@core/types'
import { PositionIcon } from './icons'
import { useApp } from '../state/store'

const GROUPS: { label: string; tiers: EloTier[] }[] = [
  { label: 'Faixas', tiers: ['ALL', 'IBSG', 'GOLD_PLUS', 'PLATINUM_PLUS', 'EMERALD_PLUS', 'DIAMOND_PLUS', 'MASTER_PLUS'] },
  { label: 'Elo exato', tiers: ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'] }
]
void ELO_TIERS

export function ControlsBar({ position, assigned }: { position: Position | null; assigned: Position | null }): ReactElement {
  const { state, dispatch, setPrefs } = useApp()
  const poolCount = Object.keys(state.prefs.pool).length
  return (
    <div className="controls" role="group" aria-label="Controles de recomendação">
      <div className="control">
        <span className="control-label" id="pos-label">Sua posição</span>
        <div className="seg positions" role="radiogroup" aria-labelledby="pos-label">
          {POSITIONS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={position === p} aria-label={POSITION_LABEL[p]} title={POSITION_LABEL[p]} className="seg-btn" onClick={() => setPrefs({ position: p })}>
              <PositionIcon position={p} size={16} />
              <span>{POSITION_LABEL[p]}</span>
            </button>
          ))}
        </div>
        {state.prefs.position == null && assigned && <span className="hint">definida pelo cliente</span>}
        {state.prefs.position != null && (state.mode === 'auto') && assigned && assigned !== state.prefs.position && (
          <button type="button" className="link-btn" onClick={() => setPrefs({ position: null })}>usar a do cliente ({POSITION_LABEL[assigned]})</button>
        )}
      </div>

      <div className="control">
        <label className="control-label" htmlFor="elo">Elo</label>
        <select id="elo" value={state.prefs.elo} onChange={(e) => setPrefs({ elo: e.target.value as EloTier })}>
          {GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.tiers.map((t) => <option key={t} value={t}>{ELO_LABEL[t]}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="spacer" />

      <label className="switch" title="Mostrar apenas campeões da sua pool">
        <input type="checkbox" role="switch" checked={state.prefs.restrictToPool} onChange={(e) => setPrefs({ restrictToPool: e.target.checked })} />
        <span className="switch-track" aria-hidden="true"><span /></span>
        <span>Só minha pool</span>
      </label>
      <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'sheet', tab: 'pool' })}>
        <Users size={15} aria-hidden="true" />
        Minha pool
        <span className="count" aria-label={`${poolCount} campeões`}>{poolCount}</span>
      </button>
    </div>
  )
}
