import { CONFIG } from './config'
import { shrinkRate } from './stats'
import { POSITIONS, type BaseStat, type Draft, type EloTier, type Position, type Preferences } from './types'
import { inferPositions } from './positions'

/** O que o processo principal precisa buscar para o motor trabalhar com dados completos. */
export interface FetchPlan {
  position: Position
  elo: EloTier
  /** Candidatos (em ordem de prioridade) cujas tabelas de matchup devem existir. */
  matchups: number[]
  /** Pares (candidato × posição de aliado) cujas sinergias devem existir. */
  synergies: { champion: number; allyPosition: Position }[]
  /** Campeões cuja base no elo escolhido deve existir (só quando difere do agregado padrão). */
  extraBase: number[]
}

const MAX_MATCHUP_CANDIDATES = 20

/**
 * Escolhe candidatos prováveis a entrar no top 5: maiores taxas de vitória encolhidas
 * (já com folga para ajustes de matchup/sinergia) + a pool pessoal. Depende só do contexto
 * estável (posição, elo, pool, posições dos aliados) — não do que o inimigo pegou.
 */
export function planFetches(input: {
  position: Position
  elo: EloTier
  draft: Draft
  prefs: Preferences
  /** Base por campeão na posição (qualquer elo; só para ordenar). */
  base: Record<number, BaseStat> | undefined
  roleRates: Record<number, Partial<Record<Position, number>>>
  unavailable: ReadonlySet<number>
}): FetchPlan {
  const { position, base, prefs } = input
  const pool = new Set(Object.keys(prefs.pool).map(Number))
  const excluded = new Set(prefs.excluded)
  const mu = (() => {
    if (!base) return 0.5
    let w = 0
    let p = 0
    for (const s of Object.values(base)) if (s.play >= CONFIG.minPlayCandidate) ((w += s.win), (p += s.play))
    return p ? w / p : 0.5
  })()

  const ranked = Object.entries(base ?? {})
    .map(([id, s]) => ({ id: Number(id), s, prior: shrinkRate(s.win, s.play, mu, CONFIG.shrinkage.base) }))
    .filter((x) => x.s.play >= CONFIG.minPlayCandidate && x.s.roleRate >= CONFIG.minRoleRate)
    .filter((x) => !input.unavailable.has(x.id) && !excluded.has(x.id))
    .filter((x) => !prefs.restrictToPool || pool.has(x.id))
    .sort((a, b) => b.prior - a.prior)

  const order: number[] = []
  const add = (id: number): void => {
    if (!order.includes(id) && !input.unavailable.has(id) && !excluded.has(id)) order.push(id)
  }
  // pool primeiro (o usuário quer vê-la bem avaliada), depois os melhores pelo prior
  for (const id of pool) add(id)
  for (const r of ranked) {
    if (order.length >= MAX_MATCHUP_CANDIDATES) break
    add(r.id)
  }
  const matchups = order.slice(0, Math.max(MAX_MATCHUP_CANDIDATES, pool.size))

  // sinergias só com aliados confirmados e posição provável conhecida
  const allyInputs = input.draft.allies.map((s) => ({
    champion: s.isMe ? null : s.state === 'locked' ? s.champion : null,
    declared: s.isMe ? position : s.position
  }))
  const dist = inferPositions(allyInputs, input.roleRates)
  const allyPositions = new Set<Position>()
  dist.forEach((d) => {
    if (d.best && d.best !== position && d.bestProbability >= CONFIG.allyPositionMinProbability) allyPositions.add(d.best)
  })
  const synergies: FetchPlan['synergies'] = []
  for (const champion of matchups) for (const pos of POSITIONS) if (allyPositions.has(pos)) synergies.push({ champion, allyPosition: pos })

  return { position, elo: input.elo, matchups, synergies, extraBase: matchups }
}
