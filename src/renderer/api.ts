import type { LeagueSenseApi } from '@shared/api'

/** Ponte com o processo principal (preload) — ou, só em desenvolvimento sem Electron, um simulador. */
export let api: LeagueSenseApi
export const setApi = (a: LeagueSenseApi): void => {
  api = a
}

export const isMock = (): boolean => !!(window as unknown as { __LS_MOCK__?: boolean }).__LS_MOCK__

/** URL de imagem de campeão. No app: protocolo local com cache em disco. No simulador: CDN do Data Dragon. */
export function championImage(kind: 'square' | 'splash' | 'loading', key: string, version: string): string {
  if (isMock()) {
    const base = 'https://ddragon.leagueoflegends.com/cdn'
    if (kind === 'square') return `${base}/${version}/img/champion/${key}.png`
    return `${base}/img/champion/${kind}/${key}_0.jpg`
  }
  return `leaguesense-img://champion/${kind}/${key}/${version}`
}
