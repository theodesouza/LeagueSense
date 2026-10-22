import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { championsInDraft, getSlot, type SlotRef } from '@core/draft'
import type { TraitsTable } from '@core/traits'
import { POSITIONS, POSITION_LABEL, type Draft, type PickState, type Position } from '@core/types'
import { ChampionGrid } from './ChampionGrid'
import type { Editable } from './DraftBoard'
import { useApp } from '../state/store'

interface Props {
  slotRef: SlotRef
  anchor: HTMLElement
  draft: Draft
  editable: Editable
  traits: TraitsTable
  onClose: () => void
}

/**
 * Popover ancorado no espaço clicado (NÃO é um modal automático: só abre por ação do usuário).
 * Manual: escolhe campeão, estado, posição e "sou eu". Automático: só a dica de posição.
 */
export function SlotPopover({ slotRef, anchor, draft, editable, traits, onClose }: Props): ReactElement {
  const { champions, version, dispatch } = useApp()
  const box = useRef<HTMLDivElement | null>(null)
  const search = useRef<HTMLInputElement | null>(null)
  const [pickState, setPickState] = useState<PickState>('locked')
  // posição calculada já na primeira renderização (o foco inicial depende de o DOM existir)
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect()
    const w = 372
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
    const below = window.innerHeight - r.bottom
    const top = below >= 360 || below > r.top ? r.bottom + 8 : Math.max(8, r.top - 8 - 440)
    return { left, top, maxH: Math.min(480, window.innerHeight - top - 8) }
  })

  const slot = getSlot(draft, slotRef)
  // Fecha e devolve o foco ao espaço. O foco é movido no quadro seguinte: se fosse na hora, o
  // "keypress" do Enter cairia no botão do espaço e reabriria o popover.
  const closeAndRestore = (): void => {
    onClose()
    requestAnimationFrame(() => anchor.focus())
  }
  const used = useMemo(() => championsInDraft(draft), [draft])
  const isPick = slotRef.kind === 'pick'
  const pickSlot = isPick ? draft[slotRef.side === 'ally' ? 'allies' : 'enemies'][slotRef.index] : undefined
  const title = `${slotRef.kind === 'pick' ? (slotRef.side === 'ally' ? 'Aliado' : 'Inimigo') : 'Banimento'} ${slotRef.index + 1}`

  useEffect(() => {
    if (editable === 'full') search.current?.focus()
    else box.current?.querySelector<HTMLElement>('button,select')?.focus()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        requestAnimationFrame(() => anchor.focus())
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, editable, onClose])

  const choose = (id: number): void => {
    dispatch({ type: 'manualSet', ref: slotRef, champion: id, state: slotRef.kind === 'ban' ? 'locked' : pickState })
    closeAndRestore()
  }

  return createPortal(
    <div ref={box} className="popover" role="dialog" aria-label={`Selecionar — ${title}`} style={{ left: pos.left, top: pos.top, maxHeight: pos.maxH }}>
      <header className="pop-head">
        <h3>{title}</h3>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={closeAndRestore}>
          <X size={16} />
        </button>
      </header>

      {editable === 'full' && (
        <ChampionGrid champions={champions} version={version} traits={traits} disabled={used} disabledLabel="já está no draft" currentId={slot?.champion ?? null} searchRef={search} onChoose={choose} />
      )}

      <footer className="pop-foot">
        {editable === 'full' && isPick && (
          <div className="seg" role="radiogroup" aria-label="Estado da escolha">
            {(['locked', 'hover'] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={(slot && slot.champion != null ? slot.state : pickState) === s} className="seg-btn" onClick={() => {
                setPickState(s)
                if (slot?.champion != null) dispatch({ type: 'manualState', ref: slotRef, state: s })
              }}>
                {s === 'locked' ? 'Confirmado' : 'Provisório'}
              </button>
            ))}
          </div>
        )}
        {isPick && pickSlot && (
          <label className="field-inline">
            <span>Posição</span>
            <select
              value={pickSlot.position ?? ''}
              onChange={(e) => {
                const v = (e.target.value || null) as Position | null
                if (editable === 'full') dispatch({ type: 'manualPosition', side: slotRef.side, index: slotRef.index, position: v })
                else if (pickSlot.champion != null) dispatch({ type: 'hint', champion: pickSlot.champion, position: v })
              }}
              disabled={editable !== 'full' && pickSlot.champion == null}
            >
              <option value="">Desconhecida</option>
              {POSITIONS.map((p) => <option key={p} value={p}>{POSITION_LABEL[p]}</option>)}
            </select>
          </label>
        )}
        {editable === 'full' && isPick && slotRef.side === 'ally' && (
          <button type="button" className="btn ghost sm" onClick={() => { dispatch({ type: 'manualMe', index: slotRef.index }); closeAndRestore() }} disabled={pickSlot?.isMe}>
            {pickSlot?.isMe ? 'É você' : 'Sou eu'}
          </button>
        )}
        {editable === 'full' && slot?.champion != null && (
          <button type="button" className="btn ghost sm danger" onClick={() => { dispatch({ type: 'manualSet', ref: slotRef, champion: null }); closeAndRestore() }}>
            Limpar
          </button>
        )}
        {editable !== 'full' && <p className="muted small">A posição é só uma dica para o cálculo; o cliente do jogo continua sendo a fonte do draft.</p>}
      </footer>
    </div>,
    document.body
  )
}
