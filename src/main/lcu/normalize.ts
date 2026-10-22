import { emptyDraft } from '@core/draft'
import type { BanSlot, Draft, DraftPhase, PickState, Position, TeamSlot } from '@core/types'

/**
 * Converte o JSON de `/lol-champ-select/v1/session` em `Draft`.
 *
 * O esquema gerado do cliente tipa `actions` como `unknown[]`; o formato dos elementos
 * (`actorCellId`, `championId`, `completed`, `isInProgress`, `isAllyAction`, `type`) é o conhecido
 * pela comunidade e NÃO foi confirmado contra um cliente real. Por isso a leitura é tolerante:
 * campos ausentes ou de tipo errado são ignorados, nunca lançam.
 */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true

const POSITION_MAP: Record<string, Position> = { top: 'top', jungle: 'jungle', middle: 'mid', mid: 'mid', bottom: 'adc', utility: 'support' }
export function mapPosition(raw: unknown): Position | null {
  return POSITION_MAP[str(raw).toLowerCase()] ?? null
}

interface Action {
  actorCellId: number
  championId: number
  completed: boolean
  inProgress: boolean
  isAlly: boolean | null
  type: string
}

function readActions(raw: unknown): Action[] {
  const out: Action[] = []
  for (const group of arr(raw)) {
    for (const a of arr(group)) {
      const o = obj(a)
      out.push({
        actorCellId: num(o.actorCellId, -1),
        championId: num(o.championId),
        completed: bool(o.completed),
        inProgress: bool(o.isInProgress),
        isAlly: typeof o.isAllyAction === 'boolean' ? o.isAllyAction : null,
        type: str(o.type).toLowerCase()
      })
    }
  }
  return out
}

export interface NormalizedSession {
  draft: Draft
  counter: number
  gameId: number
  localCellId: number
  isSpectating: boolean
}

function phaseOf(timerPhase: string, actions: Action[]): DraftPhase {
  switch (timerPhase.toUpperCase()) {
    case 'PLANNING':
      return 'planning'
    case 'BAN_PICK':
      return actions.some((a) => a.type === 'ban' && a.inProgress) ? 'banning' : 'picking'
    case 'FINALIZATION':
    case 'GAME_STARTING':
      return 'finalizing'
    default:
      return 'unknown'
  }
}

export function normalizeSession(raw: unknown, fallbackId: string): NormalizedSession | null {
  const s = obj(raw)
  if (!Array.isArray(s.myTeam) && !Array.isArray(s.theirTeam)) return null

  const actions = readActions(s.actions)
  const gameId = num(s.gameId)
  const localCellId = num(s.localPlayerCellId, -1)
  const timerPhase = str(obj(s.timer).phase)
  const phase = phaseOf(timerPhase, actions)
  const finalizing = phase === 'finalizing'
  const draft = emptyDraft(gameId > 0 ? String(gameId) : fallbackId, 'lcu', phase)

  const picks = actions.filter((a) => a.type === 'pick')
  const hasActionInfo = picks.length > 0

  const fill = (members: unknown[], slots: TeamSlot[], ally: boolean): void => {
    members.slice(0, 5).forEach((m, i) => {
      const o = obj(m)
      const cell = num(o.cellId, -1)
      const slot = slots[i]!
      const assigned = mapPosition(o.assignedPosition)
      slot.position = assigned
      slot.positionSource = assigned ? 'assigned' : 'none'
      slot.isMe = ally && cell >= 0 && cell === localCellId

      const mine = picks.filter((a) => a.actorCellId === cell)
      const done = mine.find((a) => a.completed && a.championId > 0)
      const hover = mine.find((a) => !a.completed && a.championId > 0)
      const teamChampion = num(o.championId)
      const intent = num(o.championPickIntent)

      let champion: number | null = null
      let state: PickState = 'empty'
      if (done) {
        champion = done.championId
        state = 'locked'
      } else if (!ally && teamChampion > 0 && !hasActionInfo) {
        // inimigos: o cliente só revela escolhas confirmadas
        champion = teamChampion
        state = 'locked'
      } else if (!ally && teamChampion > 0 && mine.length === 0) {
        champion = teamChampion
        state = 'locked'
      } else if (hover) {
        champion = hover.championId
        state = 'hover'
      } else if (teamChampion > 0) {
        champion = teamChampion
        // sem informação de ações (ou na finalização) a escolha atual conta como confirmada
        state = !hasActionInfo || finalizing ? 'locked' : 'hover'
      } else if (intent > 0) {
        champion = intent
        state = 'hover'
      }
      slot.champion = champion
      slot.state = state
    })
  }
  fill(arr(s.myTeam), draft.allies, true)
  fill(arr(s.theirTeam), draft.enemies, false)

  // banimentos: ações (têm ordem e distinguem provisório) + listas do cliente
  const bansAllies: BanSlot[] = []
  const bansEnemies: BanSlot[] = []
  const pushBan = (list: BanSlot[], champion: number, state: PickState): void => {
    if (champion <= 0 || list.length >= 5) return
    if (list.some((b) => b.champion === champion)) return
    list.push({ champion, state })
  }
  const myCells = new Set(arr(s.myTeam).map((m) => num(obj(m).cellId, -2)))
  for (const a of actions.filter((x) => x.type === 'ban' && x.championId > 0)) {
    const ally = a.isAlly ?? myCells.has(a.actorCellId)
    pushBan(ally ? bansAllies : bansEnemies, a.championId, a.completed ? 'locked' : 'hover')
  }
  const bans = obj(s.bans)
  for (const c of arr(bans.myTeamBans)) pushBan(bansAllies, num(c), 'locked')
  for (const c of arr(bans.theirTeamBans)) pushBan(bansEnemies, num(c), 'locked')
  // uma lista do cliente pode confirmar um banimento que a ação ainda mostra como provisório
  for (const [list, ids] of [[bansAllies, arr(bans.myTeamBans)], [bansEnemies, arr(bans.theirTeamBans)]] as const) {
    for (const b of list) if (ids.some((c) => num(c) === b.champion)) b.state = 'locked'
  }
  bansAllies.forEach((b, i) => (draft.bansAllies[i] = b))
  bansEnemies.forEach((b, i) => (draft.bansEnemies[i] = b))

  return { draft, counter: num(s.counter), gameId, localCellId, isSpectating: bool(s.isSpectating) }
}
