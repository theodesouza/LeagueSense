import { createContext, useContext, type Dispatch } from 'react'
import type { DataStatus, DraftUpdate, LcuStatus, RosterPayload } from '@shared/api'
import {
  emptyDraft,
  setMe,
  setSlotChampion,
  setSlotPosition,
  setSlotState,
  type Side,
  type SlotRef
} from '@core/draft'
import { DEFAULT_PREFERENCES, type ChampionInfo, type Draft, type PickState, type PlayerData, type Position, type Preferences } from '@core/types'

export type Mode = 'auto' | 'manual' | 'demo'
export type SheetTab = 'prefs' | 'pool' | 'data' | 'about'

export interface State {
  prefs: Preferences
  prefsLoaded: boolean
  mode: Mode
  roster: RosterPayload | null
  lcu: LcuStatus
  lcuDraft: DraftUpdate
  player: PlayerData | null
  manualDraft: Draft
  demoStep: number
  demoPlaying: boolean
  /** Dicas de posição (campeão → posição) aplicadas sobre o draft automático. */
  hints: Record<string, Position>
  data: DataStatus
  sheet: SheetTab | null
  picker: SlotRef | null
  expanded: number | null
}

export const initialLcu: LcuStatus = { state: 'searching', phase: 'None', lastEventAt: null, attempt: 0, detail: null, region: null }
export const initialData: DataStatus = { state: 'idle', progress: null, errors: [], lastUpdated: null, fromCache: false, demo: false }

export const newManualDraft = (): Draft => {
  const d = emptyDraft('manual', 'manual', 'picking')
  return setMe(d, 0)
}

export const initialState: State = {
  prefs: DEFAULT_PREFERENCES,
  prefsLoaded: false,
  mode: 'auto',
  roster: null,
  lcu: initialLcu,
  lcuDraft: { epoch: '', draft: null, updatedAt: 0 },
  player: null,
  manualDraft: newManualDraft(),
  demoStep: 0,
  demoPlaying: false,
  hints: {},
  data: initialData,
  sheet: null,
  picker: null,
  expanded: null
}

export type Action =
  | { type: 'prefs'; prefs: Preferences }
  | { type: 'roster'; roster: RosterPayload }
  | { type: 'lcu'; status: LcuStatus }
  | { type: 'lcuDraft'; update: DraftUpdate }
  | { type: 'player'; player: PlayerData }
  | { type: 'data'; data: DataStatus }
  | { type: 'mode'; mode: Mode }
  | { type: 'manualSet'; ref: SlotRef; champion: number | null; state?: PickState }
  | { type: 'manualState'; ref: SlotRef; state: PickState }
  | { type: 'manualPosition'; side: Side; index: number; position: Position | null }
  | { type: 'manualMe'; index: number }
  | { type: 'manualReset' }
  | { type: 'manualFrom'; draft: Draft }
  | { type: 'hint'; champion: number; position: Position | null }
  | { type: 'demoStep'; step: number }
  | { type: 'demoPlaying'; playing: boolean }
  | { type: 'sheet'; tab: SheetTab | null }
  | { type: 'picker'; ref: SlotRef | null }
  | { type: 'expand'; id: number | null }

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'prefs':
      return { ...s, prefs: a.prefs, prefsLoaded: true }
    case 'roster':
      return { ...s, roster: a.roster }
    case 'lcu':
      return { ...s, lcu: a.status }
    case 'lcuDraft': {
      // outra seleção (época diferente): descarta dicas, detalhes abertos e popovers do draft antigo
      const newEpoch = a.update.epoch !== s.lcuDraft.epoch
      return { ...s, lcuDraft: a.update, hints: newEpoch ? {} : s.hints, expanded: newEpoch ? null : s.expanded, picker: newEpoch && s.mode === 'auto' ? null : s.picker }
    }
    case 'player':
      return { ...s, player: a.player }
    case 'data':
      return { ...s, data: a.data }
    case 'mode':
      return { ...s, mode: a.mode, picker: null, expanded: null, demoPlaying: a.mode === 'demo' ? s.demoPlaying : false, demoStep: a.mode === 'demo' && s.mode !== 'demo' ? 0 : s.demoStep }
    case 'manualSet':
      return { ...s, manualDraft: setSlotChampion(s.manualDraft, a.ref, a.champion, a.state) }
    case 'manualState':
      return { ...s, manualDraft: setSlotState(s.manualDraft, a.ref, a.state) }
    case 'manualPosition':
      return { ...s, manualDraft: setSlotPosition(s.manualDraft, a.side, a.index, a.position) }
    case 'manualMe':
      return { ...s, manualDraft: setMe(s.manualDraft, a.index) }
    case 'manualReset':
      return { ...s, manualDraft: newManualDraft(), expanded: null }
    case 'manualFrom':
      return { ...s, manualDraft: { ...a.draft, id: 'manual', source: 'manual' }, mode: 'manual', picker: null, expanded: null }
    case 'hint': {
      const hints = { ...s.hints }
      if (a.position) hints[String(a.champion)] = a.position
      else delete hints[String(a.champion)]
      return { ...s, hints }
    }
    case 'demoStep':
      return { ...s, demoStep: a.step }
    case 'demoPlaying':
      return { ...s, demoPlaying: a.playing }
    case 'sheet':
      return { ...s, sheet: a.tab }
    case 'picker':
      return { ...s, picker: a.ref }
    case 'expand':
      return { ...s, expanded: s.expanded === a.id ? null : a.id }
  }
}

export interface Ctx {
  state: State
  dispatch: Dispatch<Action>
  /** Mapa id → campeão (da lista atual). */
  champions: ReadonlyMap<number, ChampionInfo>
  version: string
  setPrefs: (patch: Partial<Preferences>) => void
}

export const AppContext = createContext<Ctx | null>(null)
export function useApp(): Ctx {
  const c = useContext(AppContext)
  if (!c) throw new Error('AppContext ausente')
  return c
}
