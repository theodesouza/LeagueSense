import { useRef, type ReactElement } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, CircleDashed, Pencil } from 'lucide-react'
import type { Side, SlotRef } from '@core/draft'
import { POSITION_LABEL, type BanSlot, type ChampionInfo, type Draft, type TeamSlot } from '@core/types'
import { PositionIcon } from './icons'
import { Portrait } from './Portrait'
import { useApp } from '../state/store'

export type Editable = 'full' | 'position' | 'none'

interface BoardProps {
  draft: Draft
  editable: Editable
  onOpen: (ref: SlotRef, anchor: HTMLElement) => void
  activeRef: SlotRef | null
}

const sameRef = (a: SlotRef | null, b: SlotRef): boolean => !!a && a.kind === b.kind && a.side === b.side && a.index === b.index

const STATE_LABEL = { locked: 'Confirmado', hover: 'Provisório', empty: 'Aguardando' } as const

function PickSlot({
  slot,
  side,
  index,
  champion,
  version,
  editable,
  active,
  onOpen
}: {
  slot: TeamSlot
  side: Side
  index: number
  champion: ChampionInfo | undefined
  version: string
  editable: Editable
  active: boolean
  onOpen: (ref: SlotRef, anchor: HTMLElement) => void
}): ReactElement {
  const btn = useRef<HTMLButtonElement | null>(null)
  const who = side === 'ally' ? 'Aliado' : 'Inimigo'
  const posLabel = slot.position ? POSITION_LABEL[slot.position] : 'Posição desconhecida'
  const name = champion?.name ?? (slot.champion ? `Campeão ${slot.champion}` : null)
  // o nome acessível começa pelo texto visível (WCAG 2.5.3) e depois identifica o espaço
  const visible = [name, slot.isMe ? 'Você' : null, slot.position ? POSITION_LABEL[slot.position] : null, slot.state === 'hover' ? STATE_LABEL.hover : null].filter(Boolean).join(' ')
  const status = slot.champion ? (slot.state === 'locked' ? ', confirmado' : '') : ', vazio'
  const label = visible ? `${visible}, ${who} ${index + 1}${status}` : `${who} ${index + 1}, posição desconhecida${status}`
  const inner = (
    <>
      <span className="slot-frame">
        <AnimatePresence mode="popLayout" initial={false}>
          {slot.champion != null ? (
            <motion.span
              key={slot.champion}
              className="slot-portrait"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            >
              <Portrait champion={champion} version={version} size={72} className="fill" />
            </motion.span>
          ) : (
            <span className="slot-empty" aria-hidden="true">
              <PositionIcon position={slot.position} size={22} />
            </span>
          )}
        </AnimatePresence>
        {slot.state === 'locked' && (
          <motion.span className="slot-badge" aria-hidden="true" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.14, ease: [0.2, 0.7, 0.2, 1] }}>
            <Check size={12} strokeWidth={3} />
          </motion.span>
        )}
        {slot.state === 'hover' && (
          <span className="slot-badge hover" aria-hidden="true">
            <CircleDashed size={12} strokeWidth={2.4} />
          </span>
        )}
        {editable === 'full' && <span className="slot-edit" aria-hidden="true"><Pencil size={12} /></span>}
      </span>
      <span className="slot-meta">
        <span className="slot-name" data-empty={name == null || undefined}>{name}</span>{' '}
        <span className="slot-sub">
          {slot.isMe ? <b className="me-tag">Você</b> : null}{' '}
          <span className="slot-pos" data-source={slot.positionSource}>
            <PositionIcon position={slot.position} size={13} />
            <span data-unknown={slot.position == null || undefined}>{slot.position ? POSITION_LABEL[slot.position] : null}</span>
          </span>
        </span>
        <span className="slot-state" data-state={slot.state}>{STATE_LABEL[slot.state]}</span>
      </span>
    </>
  )
  const common = { className: 'slot', 'data-side': side, 'data-state': slot.state, 'data-me': slot.isMe || undefined, 'data-active': active || undefined }
  if (editable === 'none') return <div {...common} role="group" aria-label={label}>{inner}</div>
  return (
    <button
      {...common}
      ref={btn}
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={active}
      onClick={() => btn.current && onOpen({ kind: 'pick', side, index }, btn.current)}
    >
      {inner}
    </button>
  )
}

function BanChip({
  ban,
  side,
  index,
  champion,
  version,
  editable,
  active,
  onOpen
}: {
  ban: BanSlot
  side: Side
  index: number
  champion: ChampionInfo | undefined
  version: string
  editable: Editable
  active: boolean
  onOpen: (ref: SlotRef, anchor: HTMLElement) => void
}): ReactElement {
  const btn = useRef<HTMLButtonElement | null>(null)
  const label = `Banimento ${index + 1} ${side === 'ally' ? 'do seu time' : 'inimigo'}: ${champion?.name ?? (ban.champion ? `campeão ${ban.champion}` : 'vazio')}${ban.champion ? (ban.state === 'locked' ? ', banido' : ', provisório') : ''}`
  const inner = (
    <>
      <AnimatePresence initial={false}>
        {ban.champion != null && (
          <motion.span key={ban.champion} className="ban-img" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <Portrait champion={champion} version={version} size={30} className="fill" />
          </motion.span>
        )}
      </AnimatePresence>
      {ban.state === 'locked' && ban.champion != null && <span className="ban-strike" aria-hidden="true" />}
    </>
  )
  const props = { className: 'ban', 'data-state': ban.state, 'data-active': active || undefined }
  if (editable !== 'full') return <span {...props} role="img" aria-label={label} title={champion?.name}>{inner}</span>
  return (
    <button {...props} ref={btn} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={active} title={champion?.name} onClick={() => btn.current && onOpen({ kind: 'ban', side, index }, btn.current)}>
      {inner}
    </button>
  )
}

function Team({ side, draft, editable, onOpen, activeRef }: BoardProps & { side: Side }): ReactElement {
  const { champions, version } = useApp()
  const slots = side === 'ally' ? draft.allies : draft.enemies
  const bans = side === 'ally' ? draft.bansAllies : draft.bansEnemies
  const title = side === 'ally' ? 'Seu time' : 'Time inimigo'
  return (
    <section className="team" data-side={side} aria-label={title}>
      <header className="team-head">
        <h2>{title}</h2>
        <span className="team-count">{slots.filter((s) => s.state === 'locked').length}/5 confirmados</span>
      </header>
      <div className="team-slots">
        {slots.map((s, i) => (
          <PickSlot key={i} slot={s} side={side} index={i} champion={s.champion != null ? champions.get(s.champion) : undefined} version={version} editable={editable} active={sameRef(activeRef, { kind: 'pick', side, index: i })} onOpen={onOpen} />
        ))}
      </div>
      <div className="team-bans" role="group" aria-label={`Banimentos ${side === 'ally' ? 'do seu time' : 'inimigos'}`}>
        <span className="bans-label">Bans</span>
        {bans.map((b, i) => (
          <BanChip key={i} ban={b} side={side} index={i} champion={b.champion != null ? champions.get(b.champion) : undefined} version={version} editable={editable} active={sameRef(activeRef, { kind: 'ban', side, index: i })} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

export function DraftBoard(props: BoardProps): ReactElement {
  return (
    <div className="board">
      <Team {...props} side="ally" />
      <div className="board-divider" aria-hidden="true"><span>VS</span></div>
      <Team {...props} side="enemy" />
    </div>
  )
}
