import { contextBridge, ipcRenderer } from 'electron'
import type { LeagueSenseApi } from '@shared/api'
import { CH } from '@shared/channels'

const on = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const handler = (_e: Electron.IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: LeagueSenseApi = {
  app: {
    info: () => ipcRenderer.invoke(CH.appInfo),
    openExternal: (url) => ipcRenderer.invoke(CH.openExternal, url),
    clearCache: () => ipcRenderer.invoke(CH.clearCache)
  },
  prefs: {
    get: () => ipcRenderer.invoke(CH.prefsGet),
    set: (patch) => ipcRenderer.invoke(CH.prefsSet, patch),
    onChange: (cb) => on(CH.prefsChanged, cb)
  },
  roster: { get: () => ipcRenderer.invoke(CH.rosterGet) },
  stats: {
    request: (plan, mode) => ipcRenderer.invoke(CH.statsRequest, plan, mode),
    onUpdate: (cb) => on(CH.statsUpdate, cb),
    onStatus: (cb) => on(CH.statsStatusEvent, cb),
    status: () => ipcRenderer.invoke(CH.statsStatus),
    refresh: () => ipcRenderer.invoke(CH.statsRefresh)
  },
  lcu: {
    status: () => ipcRenderer.invoke(CH.lcuStatus),
    onStatus: (cb) => on(CH.lcuStatusEvent, cb),
    onDraft: (cb) => on(CH.lcuDraftEvent, cb),
    currentDraft: () => ipcRenderer.invoke(CH.lcuDraft),
    player: () => ipcRenderer.invoke(CH.lcuPlayer),
    onPlayer: (cb) => on(CH.lcuPlayerEvent, cb),
    reconnect: () => ipcRenderer.invoke(CH.lcuReconnect)
  }
}

contextBridge.exposeInMainWorld('leaguesense', api)
contextBridge.exposeInMainWorld('leaguesensePlatform', process.platform)
