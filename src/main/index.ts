import { app, BrowserWindow, ipcMain, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { ELO_TIERS, POSITIONS, type ChampionInfo, type Preferences } from '@core/types'
import type { TraitsTable } from '@core/traits'
import type { FetchPlan } from '@core/fetch-plan'
import type { AppInfo, RosterPayload } from '@shared/api'
import { CH, IMG_SCHEME, RIOT_DISCLAIMER } from '@shared/channels'
import rosterJson from '@core/data/roster.json'
import traitsJson from '@core/data/traits.json'
import type { ApplyBuildRequest } from '@shared/api'
import bundledCatalogJson from '@core/data/catalog.json'
import type { Catalog } from '@core/build-types'
import { BuildService } from './build-service'
import { MemoryCache } from './cache'
import { DiskCache } from './disk-cache'
import { DataDragon, patchOf } from './ddragon'
import { ImageStore, type ImageKind } from './image-store'
import { defaultInstallDirs, discoverCredentials, nodeDiscoverDeps } from './lcu/credentials'
import { LcuHttp } from './lcu/http'
import { openLcuSocket } from './lcu/socket'
import { LcuTracker } from './lcu/tracker'
import { SettingsStore } from './settings'
import { DemoProvider } from './sources/demo-provider'
import { McpClient } from './sources/opgg/mcp'
import { OpggProvider } from './sources/opgg/provider'
import { StatsService } from './stats-service'

/* ---------------------------------------------------------------------------
 * Ambiente. As variáveis LEAGUESENSE_* existem só para desenvolvimento e
 * verificação (ignoradas no app empacotado).
 * ------------------------------------------------------------------------- */
const dev = !app.isPackaged
const userData = (dev && process.env['LEAGUESENSE_USER_DATA']) || app.getPath('userData')
app.setPath('userData', userData)
const fault = dev ? process.env['LEAGUESENSE_FAULT'] : undefined // 'opgg' | 'ddragon' | 'all'
const extraLcuDirs = dev && process.env['LEAGUESENSE_LCU_DIR'] ? [process.env['LEAGUESENSE_LCU_DIR']] : []

protocol.registerSchemesAsPrivileged([{ scheme: IMG_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const roster = rosterJson as unknown as { ddragonVersion: string; champions: ChampionInfo[] }
const traits = (traitsJson as unknown as { traits: TraitsTable }).traits
const bundledCatalog = bundledCatalogJson as unknown as Catalog

const faultyFetch = (match: string): typeof fetch => {
  const real: typeof fetch = (...a) => fetch(...a)
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (fault && (fault === 'all' || url.includes(match) || fault === match)) return Promise.reject(new TypeError('falha simulada'))
    return real(input, init)
  }
}

/* ------------------------------- serviços ------------------------------- */
const settings = new SettingsStore(join(userData, 'settings.json'))
const cache = new DiskCache(join(userData, 'cache'))
const dd = new DataDragon({
  cache,
  bundled: roster,
  ...(fault ? { fetchImpl: faultyFetch('ddragon') } : {})
})
const images = new ImageStore(join(userData, 'images'), fault ? { fetchImpl: faultyFetch('ddragon') } : {})

const mcp = new McpClient(fault ? { fetchImpl: faultyFetch('mcp-api.op.gg') } : {})
const liveStats = new StatsService({ provider: new OpggProvider(mcp), cache, currentPatch: () => dd.patch })
const demoProvider = new DemoProvider(roster.champions, traits, patchOf(roster.ddragonVersion) ?? '0.0', 120, bundledCatalog)
const demoStats = new StatsService({
  provider: demoProvider,
  cache: new MemoryCache(),
  currentPatch: () => patchOf(roster.ddragonVersion)
})

const keyOf = (id: number): string | undefined => roster.champions.find((c) => c.id === id)?.key
const liveBuilds = new BuildService({
  provider: new OpggProvider(mcp),
  cache,
  catalog: () => dd.catalog(bundledCatalog).then((r) => r.catalog),
  enemyTips: (id) => {
    const k = keyOf(id)
    return k ? dd.enemyTips(k) : Promise.resolve([])
  },
  currentPatch: () => dd.patch
})
const demoBuilds = new BuildService({
  provider: demoProvider,
  cache: new MemoryCache(),
  catalog: () => Promise.resolve(bundledCatalog),
  enemyTips: () => Promise.resolve(['Dica de demonstração (fictícia): jogue com cautela quando a habilidade principal do oponente estiver disponível.']),
  currentPatch: () => patchOf(roster.ddragonVersion)
})

const lcu = new LcuTracker({
  discover: (scan) => discoverCredentials(nodeDiscoverDeps(defaultInstallDirs(process.platform, extraLcuDirs), scan)),
  createHttp: (c) => new LcuHttp(c),
  openSocket: (c, h) => openLcuSocket(c, h)
})

/* -------------------------------- janela -------------------------------- */
let win: BrowserWindow | null = null
const rendererUrl = dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const trustedOrigin = (url: string): boolean => (rendererUrl ? url.startsWith(rendererUrl) : url.startsWith('file://'))

const broadcast = (channel: string, payload: unknown): void => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function createWindow(): void {
  const isWin = process.platform === 'win32'
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0D0F13',
    title: 'LeagueSense',
    autoHideMenuBar: true,
    ...(isWin ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#0D0F13', symbolColor: '#AEB6C2', height: 40 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.on('will-navigate', (e, url) => {
    if (!trustedOrigin(url)) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (rendererUrl) void win.loadURL(rendererUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

/* --------------------------------- IPC --------------------------------- */
const guard =
  <A extends unknown[], R>(fn: (...a: A) => R | Promise<R>) =>
  (e: IpcMainInvokeEvent, ...a: A): R | Promise<R> => {
    const url = e.senderFrame?.url ?? ''
    if (!trustedOrigin(url)) throw new Error('remetente não confiável')
    return fn(...a)
  }

const PlanSchema = z.object({
  position: z.enum(POSITIONS),
  elo: z.enum(ELO_TIERS),
  matchups: z.array(z.number().int().positive()).max(80),
  synergies: z.array(z.object({ champion: z.number().int().positive(), allyPosition: z.enum(POSITIONS) })).max(400),
  extraBase: z.array(z.number().int().positive()).max(80)
})

const BuildRequestSchema = z.object({
  champion: z.number().int().positive(),
  position: z.enum(POSITIONS),
  elo: z.enum(ELO_TIERS),
  opponent: z.number().int().positive().nullable()
})

const id = z.number().int().positive().max(100_000)
const ApplyBuildSchema = z.object({
  champion: id,
  championName: z.string().min(1).max(40),
  buildTitle: z.string().min(1).max(40),
  items: z.array(z.object({ id, role: z.enum(['inicial', 'botas', 'principal', 'situacional']) })).max(40),
  runes: z
    .object({
      primaryStyle: id,
      primaryRunes: z.array(id).length(4),
      secondaryStyle: id,
      secondaryRunes: z.array(id).length(2),
      shards: z.array(id).length(3)
    })
    .nullable(),
  spells: z.array(id).length(2).nullable(),
  options: z.object({ items: z.boolean(), runes: z.boolean(), spells: z.boolean() })
})

const EXTERNAL_HOSTS = new Set(['developer.riotgames.com', 'support-developer.riotgames.com', 'github.com', 'hextechdocs.dev'])

let rosterPromise: Promise<RosterPayload> | null = null
const getRoster = (): Promise<RosterPayload> => (rosterPromise ??= dd.roster().catch(() => ({ version: roster.ddragonVersion, patch: patchOf(roster.ddragonVersion), champions: roster.champions, source: 'bundled' as const })))

function registerIpc(): void {
  ipcMain.handle(CH.appInfo, guard((): AppInfo => ({ version: app.getVersion(), platform: process.platform, userData, electron: process.versions.electron, disclaimer: RIOT_DISCLAIMER })))
  ipcMain.handle(
    CH.openExternal,
    guard(async (url: string) => {
      const u = new URL(String(url))
      if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) await shell.openExternal(u.href)
    })
  )
  ipcMain.handle(
    CH.clearCache,
    guard(async () => {
      await liveStats.reset()
      rosterPromise = null
    })
  )
  ipcMain.handle(CH.prefsGet, guard(() => settings.get()))
  ipcMain.handle(CH.prefsSet, guard((patch: Partial<Preferences>) => settings.set(patch ?? {})))
  ipcMain.handle(CH.rosterGet, guard(() => getRoster()))
  ipcMain.handle(
    CH.statsRequest,
    guard(async (plan: FetchPlan, mode: 'live' | 'demo') => {
      const parsed = PlanSchema.parse(plan)
      await (mode === 'demo' ? demoStats : liveStats).request(parsed)
    })
  )
  ipcMain.handle(CH.statsStatus, guard(() => liveStats.status()))
  ipcMain.handle(CH.statsRefresh, guard(() => liveStats.reset()))
  ipcMain.handle(CH.lcuStatus, guard(() => lcu.getStatus()))
  ipcMain.handle(CH.lcuDraft, guard(() => lcu.getDraft()))
  ipcMain.handle(CH.lcuPlayer, guard(() => lcu.getPlayer()))
  ipcMain.handle(CH.lcuReconnect, guard(() => lcu.reconnect()))
  ipcMain.handle(
    CH.buildsRequest,
    guard((req: unknown, mode: 'live' | 'demo') => (mode === 'demo' ? demoBuilds : liveBuilds).get(BuildRequestSchema.parse(req)))
  )
  ipcMain.handle(CH.lcuApplyBuild, guard((req: unknown) => lcu.applyBuild(ApplyBuildSchema.parse(req) satisfies ApplyBuildRequest)))
  ipcMain.handle(CH.lcuClearBuilds, guard(() => lcu.clearBuilds()))

  settings.onChange((p) => broadcast(CH.prefsChanged, p))
  for (const s of [liveStats, demoStats]) {
    s.onUpdate((u) => broadcast(CH.statsUpdate, u))
    s.onStatus((st) => broadcast(CH.statsStatusEvent, st))
  }
  lcu.onStatus((s) => broadcast(CH.lcuStatusEvent, s))
  lcu.onDraft((d) => broadcast(CH.lcuDraftEvent, d))
  lcu.onPlayer((p) => broadcast(CH.lcuPlayerEvent, p))
}

function registerImageProtocol(): void {
  protocol.handle(IMG_SCHEME, async (req) => {
    // leaguesense-img://champion/{square|splash|loading}/{chave}/{versão}
    // leaguesense-img://{item|spell|rune}/{chave}/{versão}   (rune: caminho do ícone em base64url)
    const u = new URL(req.url)
    const parts = u.pathname.split('/').filter(Boolean)
    let kind: string | undefined
    let key: string | undefined
    let version: string | undefined
    if (u.hostname === 'champion') [kind, key, version] = parts
    else if (['item', 'spell', 'rune'].includes(u.hostname)) {
      kind = u.hostname
      ;[key, version] = parts
    }
    if (!kind || !key || !version || !['square', 'splash', 'loading', 'item', 'spell', 'rune'].includes(kind)) return new Response(null, { status: 400 })
    const r = await images.get(kind as ImageKind, key, version)
    if (!r) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(r.data), { status: 200, headers: { 'content-type': r.mime, 'cache-control': 'public, max-age=86400' } })
  })
}

/* ------------------------------ ciclo de vida ------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  void app.whenReady().then(async () => {
    app.setAppUserModelId('app.leaguesense')
    await settings.load()
    registerImageProtocol()
    registerIpc()
    createWindow()
    lcu.start()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    lcu.stop()
    void settings.flush()
  })
}
