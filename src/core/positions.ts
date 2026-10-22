import { CONFIG } from './config'
import type { Position, PositionRecord } from './types'
import { POSITIONS } from './types'

export interface PositionInput {
  champion: number | null
  /** Posição já conhecida (atribuída pelo cliente ou informada manualmente). */
  declared: Position | null
}

export interface PositionDistribution {
  byPosition: Record<Position, number>
  best: Position | null
  bestProbability: number
  /** true quando veio de declaração, não de inferência. */
  declared: boolean
}

const zero = (): Record<Position, number> => ({ top: 0, jungle: 0, mid: 0, adc: 0, support: 0 })

/**
 * Infere a distribuição de posições de um time a partir da frequência de cada campeão
 * em cada rota. Modelo: as posições de um time são uma permutação; a probabilidade de uma
 * atribuição é proporcional ao produto das frequências (com piso). A marginal por campeão é
 * obtida enumerando todas as atribuições (≤ 120). Posições declaradas são fixas.
 *
 * Retorna um item por entrada; entradas sem campeão recebem distribuição vazia.
 */
export function inferPositions(
  entries: PositionInput[],
  roleRates: Record<number, PositionRecord<number>>
): PositionDistribution[] {
  const out: PositionDistribution[] = entries.map(() => ({
    byPosition: zero(),
    best: null,
    bestProbability: 0,
    declared: false
  }))

  const taken = new Set<Position>()
  const free: number[] = []
  entries.forEach((e, i) => {
    if (e.champion == null) return
    if (e.declared && !taken.has(e.declared)) {
      taken.add(e.declared)
      const o = out[i]!
      o.byPosition[e.declared] = 1
      o.best = e.declared
      o.bestProbability = 1
      o.declared = true
    } else {
      free.push(i)
    }
  })

  const freePositions = POSITIONS.filter((p) => !taken.has(p))
  if (free.length === 0) return out

  const rate = (champion: number, pos: Position): number => {
    const r = roleRates[champion]
    if (!r || Object.keys(r).length === 0) return 1 / 5
    return Math.max(r[pos] ?? 0, CONFIG.rolePriorFloor)
  }

  const marginals = free.map(() => zero())
  let total = 0
  const used = new Set<Position>()
  const assignment: Position[] = []

  const walk = (depth: number, likelihood: number): void => {
    if (depth === free.length) {
      total += likelihood
      assignment.forEach((pos, j) => {
        marginals[j]![pos] += likelihood
      })
      return
    }
    const champion = entries[free[depth]!]!.champion as number
    for (const pos of freePositions) {
      if (used.has(pos)) continue
      used.add(pos)
      assignment.push(pos)
      walk(depth + 1, likelihood * rate(champion, pos))
      assignment.pop()
      used.delete(pos)
    }
  }

  // mais campeões livres que posições livres (declarações duplicadas) não ocorre: no máximo 5
  if (free.length <= freePositions.length) walk(0, 1)

  free.forEach((entryIndex, j) => {
    const o = out[entryIndex]!
    let best: Position | null = null
    let bestP = 0
    for (const pos of POSITIONS) {
      const p = total > 0 ? marginals[j]![pos] / total : 0
      o.byPosition[pos] = p
      if (p > bestP) {
        bestP = p
        best = pos
      }
    }
    o.best = best
    o.bestProbability = bestP
  })

  return out
}
