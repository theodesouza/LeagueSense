import { CONFIG } from './config'

export interface Ranked {
  championId: number
  score: number
  totalPp: number
}

/**
 * Ordena por pontuação com histerese. Em ordem natural (maior primeiro), formam‑se grupos:
 * um grupo começa em um item e inclui os seguintes cuja pontuação esteja a até `epsilon`
 * pontos da do primeiro. Dentro de um grupo vale a ordem exibida anteriormente (`previous`);
 * itens que não estavam na lista anterior vão ao fim do grupo, em ordem natural.
 *
 * Efeito: oscilações pequenas entre atualizações não embaralham a lista, e um campeão só
 * "pula" outro quando a diferença é maior que `epsilon`. Determinístico para entradas iguais.
 */
export function rankStable<T extends Ranked>(
  items: T[],
  previous: readonly number[] = [],
  epsilon: number = CONFIG.rankHysteresis
): T[] {
  const natural = [...items].sort((a, b) => b.totalPp - a.totalPp || a.championId - b.championId)
  if (previous.length === 0 || natural.length < 2) return natural

  const prevIndex = new Map<number, number>()
  previous.forEach((id, i) => {
    if (!prevIndex.has(id)) prevIndex.set(id, i)
  })

  const out: T[] = []
  let i = 0
  while (i < natural.length) {
    const head = natural[i]!
    const group: T[] = [head]
    let j = i + 1
    while (j < natural.length && head.score - natural[j]!.score <= epsilon) {
      group.push(natural[j]!)
      j++
    }
    group.sort((a, b) => {
      const pa = prevIndex.get(a.championId)
      const pb = prevIndex.get(b.championId)
      if (pa != null && pb != null) return pa - pb
      if (pa != null) return -1
      if (pb != null) return 1
      return 0 // ambos novos: preserva a ordem natural (sort é estável)
    })
    out.push(...group)
    i = j
  }
  return out
}
