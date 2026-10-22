const pct1 = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pct0 = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 })
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const dec1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' })

export const fmtPct = (v: number): string => pct1.format(v)
export const fmtPct0 = (v: number): string => pct0.format(v)
export const fmtInt = (v: number): string => int.format(v)
/** "+1,8" / "−0,6" para contribuições em pp. */
export const fmtSignedPp = (v: number): string => dec1.format(Math.round(v * 10) / 10).replace('-', '−')

export function fmtAge(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

export const ELO_LABEL: Record<string, string> = {
  ALL: 'Todos os elos',
  IBSG: 'Ferro a Ouro',
  IRON: 'Ferro',
  BRONZE: 'Bronze',
  SILVER: 'Prata',
  GOLD: 'Ouro',
  GOLD_PLUS: 'Ouro+',
  PLATINUM: 'Platina',
  PLATINUM_PLUS: 'Platina+',
  EMERALD: 'Esmeralda',
  EMERALD_PLUS: 'Esmeralda+',
  DIAMOND: 'Diamante',
  DIAMOND_PLUS: 'Diamante+',
  MASTER: 'Mestre',
  MASTER_PLUS: 'Mestre+',
  GRANDMASTER: 'Grão-Mestre',
  CHALLENGER: 'Desafiante'
}
