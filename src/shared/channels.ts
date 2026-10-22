export const CH = {
  appInfo: 'app:info',
  openExternal: 'app:open-external',
  clearCache: 'app:clear-cache',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  prefsChanged: 'prefs:changed',
  rosterGet: 'roster:get',
  statsRequest: 'stats:request',
  statsRefresh: 'stats:refresh',
  statsStatus: 'stats:status',
  statsStatusEvent: 'stats:status-event',
  statsUpdate: 'stats:update',
  lcuStatus: 'lcu:status',
  lcuStatusEvent: 'lcu:status-event',
  lcuDraft: 'lcu:draft',
  lcuDraftEvent: 'lcu:draft-event',
  lcuPlayer: 'lcu:player',
  lcuPlayerEvent: 'lcu:player-event',
  lcuReconnect: 'lcu:reconnect',
  buildsRequest: 'builds:request',
  lcuApplyBuild: 'lcu:apply-build',
  lcuClearBuilds: 'lcu:clear-builds'
} as const

/** Esquema do protocolo de imagens: leaguesense-img://champion/{tipo}/{chave}/{versão}, ://item|spell/{chave}/{versão} e ://rune/{caminho-base64url}/{versão} */
export const IMG_SCHEME = 'leaguesense-img'

export const statsContextKey = (source: 'opgg-mcp' | 'demo', position: string, elo: string): string => `${source}:${position}:${elo}`

/** Texto exigido pela política da Riot (Developer Portal › Core Policies). */
export const RIOT_DISCLAIMER =
  "LeagueSense isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."
