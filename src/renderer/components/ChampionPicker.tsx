import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { championsInDraft, getSlot, type SlotRef } from '@core/draft'
import type { TraitsTable } from '@core/traits'
import { POSITIONS, POSITION_LABEL, type Draft, type PickState, type Position } from '@core/types'
import { PositionIcon } from './icons'
import { Portrait } from './Portrait'
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

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Popover ancorado no espaço clicado (NÃO é um modal automático: só abre por ação do usuário).
 * Manual: escolhe campeão, estado, posição e "sou eu". Automático: só a dica de posição.
 */
export function SlotPopover({ slotRef, anchor, draft, editable, traits, onClose }: Props): ReactElement {
  const { champions, version, dispatch } = useApp()
  const box = useRef<HTMLDivElement | null>(null)
  const search = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Position | 'all'>('all')
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

  const list = useMemo(() => {
    const q = norm(query.trim())
    return [...champions.values()]
      .filter((c) => (q ? norm(c.name).includes(q) || norm(c.nameEn).includes(q) : true))
      .filter((c) => (role === 'all' ? true : traits[c.id]?.positions.includes(role) ?? true))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [champions, query, role, traits])

  const choose = (id: number): void => {
    dispatch({ type: 'manualSet', ref: slotRef, champion: id, state: slotRef.kind === 'ban' ? 'locked' : pickState })
    closeAndRestore()
  }

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button.tile:not(:disabled)')]
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const cols = Math.max(1, Math.floor(e.currentTarget.clientWidth / 64))
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key]
    if (move == null) return
    e.preventDefault()
    const next = tiles[i + move]
    if (next) next.focus()
    else if (move < 0) search.current?.focus()
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
        <>
          <label className="search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              placeholder="Buscar campeão…"
              aria-label="Buscar campeão"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  box.current?.querySelector<HTMLButtonElement>('button.tile:not(:disabled)')?.focus()
                }
                if (e.key === 'Enter' && list.length > 0) {
                  const first = list.find((c) => !used.has(c.id) || c.id === slot?.champion)
                  if (first) choose(first.id)
                }
              }}
            />
          </label>
          <div className="chips" role="radiogroup" aria-label="Filtrar por posição">
            {(['all', ...POSITIONS] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={role === p} className="chip" data-on={role === p || undefined} onClick={() => setRole(p)}>
                {p === 'all' ? 'Todos' : (<><PositionIcon position={p} size={13} />{POSITION_LABEL[p]}</>)}
              </button>
            ))}
          </div>
          <div className="tiles" role="group" aria-label="Campeões" onKeyDown={onGridKey}>
            {list.map((c) => {
              const inUse = used.has(c.id) && c.id !== slot?.champion
              return (
                <button key={c.id} type="button" className="tile" disabled={inUse} data-current={c.id === slot?.champion || undefined} aria-label={inUse ? `${c.name} (já está no draft)` : c.name} title={inUse ? 'Já está no draft' : c.name} onClick={() => choose(c.id)}>
                  <Portrait champion={c} version={version} size={44} />
                  <span>{c.name}</span>
                </button>
              )
            })}
            {list.length === 0 && <p className="muted pad">Nenhum campeão encontrado.</p>}
          </div>
        </>
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
