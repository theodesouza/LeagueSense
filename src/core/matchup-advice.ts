import { fmtInt, fmtPct, fmtPct0 } from './format'
import type { ChampionTraits } from './traits'
import type { MatchupAdvice, MatchupGuideData, MatchupLine } from './build-types'

export interface MatchupInput {
  me: number
  opponent: number
  /** Probabilidade de ser o oponente de rota (1 = informado). */
  probability: number
  nameOf: (id: number) => string
  meTraits: ChampionTraits
  oppTraits: ChampionTraits
  /** Partidas e vitórias do meu campeão contra o oponente (tabela de confrontos ou guia). */
  record: { play: number; win: number } | null
  guide: MatchupGuideData | null
  /** Dicas oficiais da Riot (pt-BR) para enfrentar o oponente. */
  riotTips: string[]
  /** Origem dos dados do guia: no modo demonstração tudo é fictício e é rotulado assim. */
  dataSource?: 'opgg' | 'demo'
}

const K = 300
const trim = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * Dica de confronto para o oponente de rota mais provável. Mistura dados (taxa de vitória, indicações do
 * OP.GG), regras do LeagueSense sobre os traços dos campeões e as dicas oficiais da Riot — cada linha diz
 * de onde vem, para o usuário saber o que é dado e o que é regra.
 */
export function matchupAdvice(i: MatchupInput): MatchupAdvice {
  const demo = i.dataSource === 'demo'
  const SRC = demo ? 'demonstração (fictício)' : 'OP.GG'
  const WHO = demo ? 'Os dados de demonstração (fictícios)' : 'O OP.GG'
  const opp = i.nameOf(i.opponent)
  const me = i.nameOf(i.me)
  const lines: MatchupLine[] = []

  /* ---- estatística ---- */
  let verdict: MatchupAdvice['verdict'] = 'sem-dados'
  let record: MatchupAdvice['record'] = null
  if (i.record && i.record.play > 0) {
    const wr = i.record.win / i.record.play
    const adj = (i.record.win + K / 2) / (i.record.play + K)
    record = { play: i.record.play, win: i.record.win, winRate: wr }
    verdict = i.record.play < 50 ? 'sem-dados' : adj >= 0.515 ? 'favoravel' : adj <= 0.485 ? 'desfavoravel' : 'equilibrado'
    lines.push({
      kind: 'estatistica',
      text:
        verdict === 'sem-dados'
          ? `Poucos jogos de ${me} contra ${opp} (${fmtInt(i.record.play)}): ${fmtPct(wr)} de vitórias, sem confiança para dizer quem leva vantagem.`
          : `${me} vence ${fmtPct(wr)} das partidas contra ${opp} (${fmtInt(i.record.play)} jogos; ${fmtPct(adj)} depois de ajustar pela amostra) — confronto ${verdict === 'favoravel' ? 'favorável' : verdict === 'desfavoravel' ? 'desfavorável' : 'equilibrado'}.`,
      source: `${SRC} · taxa de vitória do confronto`
    })
  }

  /* ---- indicações do OP.GG sobre o confronto ---- */
  const g = i.guide
  if (g?.playStyle) {
    lines.push({
      kind: 'estilo',
      text: g.playStyle === 'defensive' ? `${WHO} recomenda jogar mais defensivo neste confronto: farme com segurança e evite trocas caras.` : g.playStyle === 'aggressive' ? `${WHO} recomenda jogar mais agressivo neste confronto: pressione a rota e use sua vantagem.` : `${WHO} classifica o confronto como equilibrado: sem necessidade de jogar muito agressivo ou defensivo.`,
      source: `${SRC} · análise do confronto`
    })
  }
  if (g?.laneAdvantage && g.laneAdvantage !== 'even') {
    lines.push({ kind: 'estilo', text: g.laneAdvantage === 'me' ? `A vantagem na rota (fase de rotas) é sua.` : `A vantagem na rota é do ${opp}: respeite o nível 1–3 e evite brigar sem necessidade.`, source: `${SRC} · análise do confronto` })
  }
  if (g?.soloKillAdvantage && g.soloKillAdvantage !== 'even') {
    lines.push({ kind: 'estilo', text: g.soloKillAdvantage === 'opponent' ? `${opp} tem vantagem em abates 1x1: não aceite duelos longos sem sua habilidade principal e sem escape.` : `Você tem vantagem em abates 1x1: um all-in bem cronometrado pode eliminar ${opp}.`, source: `${SRC} · análise do confronto` })
  }
  const best = g?.gameLengths.length ? [...g.gameLengths].sort((a, b) => b.rate - a.rate)[0] : undefined
  const worst = g?.gameLengths.length ? [...g.gameLengths].sort((a, b) => a.rate - b.rate)[0] : undefined
  if (best && worst && best.rate - worst.rate >= 0.04) {
    const span = (from: number): string => (from === 0 ? 'até 25 min' : from >= 40 ? 'depois de 40 min' : `entre ${from} e ${from + 5} min`)
    lines.push({ kind: 'estilo', text: `Neste confronto sua taxa de vitória é maior em partidas ${span(best.from)} (${fmtPct(best.rate)}) e menor ${span(worst.from)} (${fmtPct(worst.rate)}). Indicativo: a amostra por duração não é informada.`, source: `${SRC} · vitórias por duração` })
  }

  /* ---- regras do LeagueSense sobre traços ---- */
  const m = i.meTraits
  const o = i.oppTraits
  const rule = (text: string): void => void lines.push({ kind: 'heuristica', text, source: 'Regra do LeagueSense (traços dos campeões)' })
  if (m.ranged && !o.ranged) rule(`Você ataca à distância e ${opp} é corpo a corpo: mantenha distância, castigue quando ele avançar e controle a onda perto da sua torre.`)
  else if (!m.ranged && o.ranged) rule(`${opp} ataca à distância e você é corpo a corpo: aproxime-se pelos arbustos e use a onda de tropas para forçar trocas; evite ficar parado no alcance dele.`)
  if (o.dive >= 0.8 && m.frontline < 0.5) rule(`${opp} tem alta mobilidade/ameaça de mergulho: guarde seu escape e fique perto da torre e de aliados quando ele estiver com as habilidades prontas.`)
  if (o.cc >= 0.9) rule(`${opp} tem controle de grupo forte: não fique em linha reta com ele nem avance sem ver onde está a habilidade principal dele.`)
  if (o.sustain >= 0.6) rule(`${opp} se cura em trocas longas: prefira trocas curtas e, se ficar atrás, considere item de redução de cura.`)
  if (o.frontline >= 0.8 && m.frontline < 0.6) rule(`${opp} é resistente: trocas longas rendem pouco dano. Priorize farm, vantagem de nível e objetivos em vez de forçar abates.`)

  /* ---- dicas oficiais (Data Dragon, pt-BR) e dica do OP.GG ---- */
  for (const t of i.riotTips.slice(0, 3)) lines.push({ kind: 'riot', text: trim(t), source: demo ? 'demonstração (fictício) · dica de exemplo' : `Dicas oficiais da Riot contra ${opp}` })
  if (g?.tipEn) lines.push({ kind: 'opgg', text: trim(g.tipEn), source: `${SRC} · dica em inglês (não traduzida)` })

  const prov = i.probability >= 0.95 ? 'oponente de rota' : `provável oponente de rota, ${Math.round(i.probability * 100)}%`
  const vtxt = { favoravel: 'confronto favorável', equilibrado: 'confronto equilibrado', desfavoravel: 'confronto desfavorável', 'sem-dados': 'sem dados suficientes de confronto' }[verdict]
  return {
    opponent: i.opponent,
    probability: i.probability,
    verdict,
    headline: `Contra ${opp} (${prov}): ${vtxt}${record && verdict !== 'sem-dados' ? ` — ${fmtPct0(record.winRate)} em ${fmtInt(record.play)} partidas` : ''}`,
    record,
    lines,
    uncertainty: i.probability < 0.75 ? `A posição inimiga não é certa (${opp}: ${Math.round(i.probability * 100)}%). Use estas dicas se ele realmente for seu oponente de rota; marque a posição dele no draft para confirmar.` : null
  }
}
