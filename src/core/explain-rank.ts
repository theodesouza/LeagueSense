import { CONFIG } from './config'
import { fmtSignedPp } from './format'
import type { Factor, ReasonKind, Recommendation } from './types'

const LABEL: Record<ReasonKind, string> = {
  base: 'taxa de vitória na rota',
  matchup: 'confronto de rota',
  synergy: 'sinergia com aliados',
  damage: 'equilíbrio de dano do time',
  frontline: 'linha de frente',
  engage: 'engajamento',
  cc: 'controle de grupo',
  peel: 'proteção ao carregador',
  disengage: 'desengajar contra mergulho',
  range: 'alcance',
  familiarity: 'sua familiaridade'
}

export interface RankPoint {
  kind: ReasonKind
  /** Diferença (p.p.) a favor (+) ou contra (−) do 1º em relação ao 2º. */
  diffPp: number
  text: string
}

export interface RankExplanation {
  first: number
  second: number | null
  /** Diferença de pontuação (0–100) entre o 1º e o 2º. */
  scoreGap: number
  /** Diferença menor que a histerese: empate prático. */
  tie: boolean
  headline: string
  advantages: RankPoint[]
  tradeoffs: RankPoint[]
}

const byKind = (fs: Factor[]): Map<ReasonKind, number> => {
  const m = new Map<ReasonKind, number>()
  for (const f of fs) m.set(f.kind, (m.get(f.kind) ?? 0) + f.pp)
  return m
}

/**
 * Explica POR QUE o 1º está no topo, comparando-o com o 2º fator a fator. Usa exatamente as contribuições
 * que o motor somou — nenhuma justificativa nova.
 */
export function explainTop(items: Recommendation[], nameOf: (id: number) => string): RankExplanation | null {
  const a = items[0]
  if (!a) return null
  const b = items[1]
  if (!b) {
    return { first: a.championId, second: null, scoreGap: 0, tie: false, headline: `${nameOf(a.championId)} é a única opção disponível com os filtros e bloqueios atuais.`, advantages: [], tradeoffs: [] }
  }
  const A = byKind(a.factors)
  const B = byKind(b.factors)
  const kinds = new Set<ReasonKind>([...A.keys(), ...B.keys()])
  const pts: RankPoint[] = []
  for (const k of kinds) {
    const d = (A.get(k) ?? 0) - (B.get(k) ?? 0)
    if (Math.abs(d) < 0.3) continue
    pts.push({
      kind: k,
      diffPp: d,
      text: d > 0 ? `${LABEL[k]}: ${fmtSignedPp(d)} p.p. a mais que ${nameOf(b.championId)}` : `${LABEL[k]}: ${nameOf(b.championId)} leva ${fmtSignedPp(-d)} p.p. de vantagem`
    })
  }
  const advantages = pts.filter((p) => p.diffPp > 0).sort((x, y) => y.diffPp - x.diffPp).slice(0, 3)
  const tradeoffs = pts.filter((p) => p.diffPp < 0).sort((x, y) => x.diffPp - y.diffPp).slice(0, 2)
  const gap = a.score - b.score
  const tie = gap <= CONFIG.rankHysteresis
  const total = a.totalPp - b.totalPp
  const headline = tie
    ? `${nameOf(a.championId)} e ${nameOf(b.championId)} estão praticamente empatados (${gap.toFixed(1).replace('.', ',')} ponto de adequação). A ordem anterior foi mantida para a lista não oscilar.`
    : advantages.length > 0
      ? `${nameOf(a.championId)} está em 1º porque soma ${fmtSignedPp(total)} p.p. a mais que ${nameOf(b.championId)}, principalmente por ${advantages[0]!.text.split(':')[0]}.`
      : `${nameOf(a.championId)} está em 1º por uma soma ${fmtSignedPp(total)} p.p. maior que a de ${nameOf(b.championId)}, espalhada em vários fatores pequenos.`
  return { first: a.championId, second: b.championId, scoreGap: gap, tie, headline, advantages, tradeoffs }
}
