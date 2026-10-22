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

const DD = 'https://ddragon.leagueoflegends.com/cdn'

/** Ícone de item (Data Dragon, com cache em disco no app). */
export function itemImage(id: number, version: string): string {
  return isMock() ? `${DD}/${version}/img/item/${id}.png` : `leaguesense-img://item/${id}/${version}`
}

/** Ícone de feitiço de invocador; `key` é o id de imagem (ex.: SummonerFlash). */
export function spellImage(key: string, version: string): string {
  return isMock() ? `${DD}/${version}/img/spell/${key}.png` : `leaguesense-img://spell/${key}/${version}`
}

const b64url = (s: string): string => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Ícone de runa/estilo/fragmento: `path` vem do catálogo (ex.: perk-images/Styles/...). */
export function runeImage(path: string, version: string): string {
  return isMock() ? `${DD}/img/${path}` : `leaguesense-img://rune/${b64url(path)}/${version}`
}
