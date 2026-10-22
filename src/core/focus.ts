import { unavailableChampions } from './draft'
import type { TeamMember } from './composition'
import { CONFIG } from './config'
import type { ChampionTraits } from './traits'
import type { Draft } from './types'

export type FocusSource = 'travado' | 'escolhido' | 'provisorio' | 'sugestao'

export interface Focus {
  champion: number
  source: FocusSource
  /** Aviso opcional (ex.: a escolha feita no app deixou de estar disponível). */
  note: string | null
}

/**
 * Campeão sobre o qual o plano de jogo é montado. Precedência:
 *   1. o que já travei no cliente (a verdade do jogo);
 *   2. o que escolhi no app (se ainda disponível);
 *   3. o que está provisório (passando o mouse) no meu espaço;
 *   4. a melhor recomendação.
 */
export function resolveFocus(args: { draft: Draft; myPick: number | null; top: number | null; nameOf: (id: number) => string }): Focus | null {
  const { draft, myPick, top, nameOf } = args
  const me = draft.allies.find((s) => s.isMe)
  if (me?.champion != null && me.state === 'locked') return { champion: me.champion, source: 'travado', note: myPick != null && myPick !== me.champion ? `Você travou ${nameOf(me.champion)} no cliente; o plano segue essa escolha.` : null }
  let note: string | null = null
  if (myPick != null) {
    if (!unavailableChampions(draft).has(myPick)) return { champion: myPick, source: 'escolhido', note: null }
    note = `${nameOf(myPick)} não está mais disponível (banido ou escolhido). Escolha outro campeão.`
  }
  if (me?.champion != null && me.state === 'hover') return { champion: me.champion, source: 'provisorio', note }
  return top != null ? { champion: top, source: 'sugestao', note } : null
}

/** Membros de equipe (com peso) a partir do draft; o próprio jogador não entra entre os aliados. */
export function membersOf(draft: Draft, traitsOf: (id: number) => ChampionTraits): { allies: TeamMember[]; enemies: TeamMember[] } {
  const take = (slots: Draft['allies'], skipMe: boolean): TeamMember[] =>
    slots.flatMap((s) =>
      s.champion == null || s.state === 'empty' || (skipMe && s.isMe) ? [] : [{ champion: s.champion, weight: s.state === 'locked' ? 1 : CONFIG.hoverWeight, traits: traitsOf(s.champion) }]
    )
  return { allies: take(draft.allies, true), enemies: take(draft.enemies, false) }
}
