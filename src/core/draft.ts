import type { BanSlot, Draft, DraftPhase, DraftSource, PickState, Position, TeamSlot } from './types'
import { POSITIONS } from './types'

const emptySlot = (): TeamSlot => ({
  champion: null,
  state: 'empty',
  position: null,
  positionSource: 'none',
  isMe: false
})
const emptyBan = (): BanSlot => ({ champion: null, state: 'empty' })

export function emptyDraft(id: string, source: DraftSource, phase: DraftPhase = 'idle'): Draft {
  return {
    id,
    source,
    phase,
    allies: Array.from({ length: 5 }, emptySlot),
    enemies: Array.from({ length: 5 }, emptySlot),
    bansAllies: Array.from({ length: 5 }, emptyBan),
    bansEnemies: Array.from({ length: 5 }, emptyBan)
  }
}

export type Side = 'ally' | 'enemy'
export type SlotRef =
  | { kind: 'pick'; side: Side; index: number }
  | { kind: 'ban'; side: Side; index: number }

/** Campeões com escolha confirmada (picks bloqueados) de um lado. */
export function lockedPicks(slots: TeamSlot[]): number[] {
  return slots.filter((s) => s.state === 'locked' && s.champion != null).map((s) => s.champion as number)
}

export function lockedBans(draft: Draft): number[] {
  return [...draft.bansAllies, ...draft.bansEnemies]
    .filter((b) => b.state === 'locked' && b.champion != null)
    .map((b) => b.champion as number)
}

/**
 * Campeões que não podem mais ser escolhidos: banidos e escolhidos (confirmados).
 * Seleções temporárias de aliados NÃO bloqueiam (podem mudar) — viram aviso.
 */
export function unavailableChampions(draft: Draft): Set<number> {
  return new Set<number>([...lockedPicks(draft.allies), ...lockedPicks(draft.enemies), ...lockedBans(draft)])
}

export function hoveredByAllies(draft: Draft): Set<number> {
  const out = new Set<number>()
  for (const s of draft.allies) if (s.state === 'hover' && s.champion != null && !s.isMe) out.add(s.champion)
  return out
}

/** Campeões presentes em qualquer lugar do draft (para impedir duplicatas na edição manual). */
export function championsInDraft(draft: Draft): Set<number> {
  const out = new Set<number>()
  for (const s of [...draft.allies, ...draft.enemies]) if (s.champion != null) out.add(s.champion)
  for (const b of [...draft.bansAllies, ...draft.bansEnemies]) if (b.champion != null) out.add(b.champion)
  return out
}

function cloneDraft(d: Draft): Draft {
  return {
    ...d,
    allies: d.allies.map((s) => ({ ...s })),
    enemies: d.enemies.map((s) => ({ ...s })),
    bansAllies: d.bansAllies.map((b) => ({ ...b })),
    bansEnemies: d.bansEnemies.map((b) => ({ ...b }))
  }
}

function clearChampion(d: Draft, champion: number): void {
  for (const s of [...d.allies, ...d.enemies]) {
    if (s.champion === champion) {
      s.champion = null
      s.state = 'empty'
    }
  }
  for (const b of [...d.bansAllies, ...d.bansEnemies]) {
    if (b.champion === champion) {
      b.champion = null
      b.state = 'empty'
    }
  }
}

/**
 * Edição manual: coloca/remove um campeão em um espaço. Se o campeão já estava em
 * outro espaço, ele é movido (o draft nunca tem duplicatas).
 */
export function setSlotChampion(
  draft: Draft,
  ref: SlotRef,
  champion: number | null,
  state: PickState = 'locked'
): Draft {
  const d = cloneDraft(draft)
  if (champion != null) clearChampion(d, champion)
  const target: TeamSlot | BanSlot | undefined =
    ref.kind === 'pick'
      ? (ref.side === 'ally' ? d.allies : d.enemies)[ref.index]
      : (ref.side === 'ally' ? d.bansAllies : d.bansEnemies)[ref.index]
  if (!target) return draft
  target.champion = champion
  target.state = champion == null ? 'empty' : state
  return d
}

export function setSlotState(draft: Draft, ref: SlotRef, state: PickState): Draft {
  const current = getSlot(draft, ref)
  if (!current || current.champion == null) return draft
  return setSlotChampion(draft, ref, current.champion, state)
}

export function getSlot(draft: Draft, ref: SlotRef): TeamSlot | BanSlot | undefined {
  if (ref.kind === 'pick') return (ref.side === 'ally' ? draft.allies : draft.enemies)[ref.index]
  return (ref.side === 'ally' ? draft.bansAllies : draft.bansEnemies)[ref.index]
}

/** Define a posição declarada de um espaço (manual). `null` limpa. */
export function setSlotPosition(draft: Draft, side: Side, index: number, position: Position | null): Draft {
  const d = cloneDraft(draft)
  const slots = side === 'ally' ? d.allies : d.enemies
  const slot = slots[index]
  if (!slot) return draft
  if (position != null) {
    // uma posição por time: tira de quem já a tinha
    for (const s of slots) {
      if (s !== slot && s.position === position && s.positionSource === 'manual') {
        s.position = null
        s.positionSource = 'none'
      }
    }
  }
  slot.position = position
  slot.positionSource = position == null ? 'none' : 'manual'
  return d
}

export function setMe(draft: Draft, index: number): Draft {
  const d = cloneDraft(draft)
  d.allies.forEach((s, i) => (s.isMe = i === index))
  return d
}

export function meIndex(draft: Draft): number {
  return draft.allies.findIndex((s) => s.isMe)
}

/** Posição atribuída/declarada do jogador local, se houver. */
export function myDeclaredPosition(draft: Draft): Position | null {
  const me = draft.allies.find((s) => s.isMe)
  return me?.position ?? null
}

export function isDraftEmpty(draft: Draft): boolean {
  return (
    draft.allies.every((s) => s.champion == null) &&
    draft.enemies.every((s) => s.champion == null) &&
    draft.bansAllies.every((b) => b.champion == null) &&
    draft.bansEnemies.every((b) => b.champion == null)
  )
}

export function isPosition(v: unknown): v is Position {
  return typeof v === 'string' && (POSITIONS as readonly string[]).includes(v)
}
