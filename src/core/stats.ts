/** Matemática estatística simples e testável (encolhimento bayesiano). */

/** Taxa posterior com prior Beta de força `k` (pseudo-partidas) centrado em `prior`. */
export function shrinkRate(win: number, play: number, prior: number, k: number): number {
  if (!(play > 0)) return prior
  return (win + k * prior) / (play + k)
}

/** Fração do peso que a amostra observada recebe (0–1). */
export function sampleWeight(play: number, k: number): number {
  if (!(play > 0)) return 0
  return play / (play + k)
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Pontuação 0–100 monotônica; escala fixa (não depende dos demais candidatos). */
export function adequacy(totalPp: number, scalePp: number): number {
  return 100 / (1 + Math.exp(-totalPp / scalePp))
}

/** Taxa de vitória reconstruída para exibição. */
export function winRate(win: number, play: number): number | null {
  return play > 0 ? win / play : null
}
