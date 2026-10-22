/**
 * SIMULADOR DA PONTE (somente desenvolvimento / verificação visual em navegador comum).
 * Usa o mesmo StatsService e o mesmo motor, mas com um provedor de dados FICTÍCIOS. Não é usado no app
 * empacotado (lá a ponte real vem do preload). Permite forçar estados via `window.__LS__`.
 */
import rosterJson from '@core/data/roster.json'
import traitsJson from '@core/data/traits.json'
import catalogJson from '@core/data/catalog.json'
import type { Catalog } from '@core/build-types'
import type { TraitsTable } from '@core/traits'
import { DEFAULT_PREFERENCES, type ChampionInfo, type Draft, type PlayerData, type Preferences } from '@core/types'
import type { ApplyBuildRequest, ApplyResult, DataStatus, DraftUpdate, LcuStatus, LeagueSenseApi, RosterPayload } from '@shared/api'
import { RIOT_DISCLAIMER } from '@shared/channels'
import { MemoryCache } from '../../main/cache'
import { SourceFailure } from '../../main/errors'
import { BuildService } from '../../main/build-service'
import { StatsService } from '../../main/stats-service'
import { DemoProvider } from '../../main/sources/demo-provider'

const roster = rosterJson as unknown as { ddragonVersion: string; champions: ChampionInfo[] }
const traits = (traitsJson as unknown as { traits: TraitsTable }).traits
const catalog = catalogJson as unknown as Catalog
const patch = roster.ddragonVersion.split('.').slice(0, 2).join('.')

class Emitter<T> {
  private ls = new Set<(v: T) => void>()
  on = (cb: (v: T) => void): (() => void) => {
    this.ls.add(cb)
    return () => this.ls.delete(cb)
  }
  emit = (v: T): void => this.ls.forEach((l) => l(v))
}

export interface MockControls {
  failStats: boolean
  failBuilds: boolean
  /** 'ok' | 'fail' | 'items-only-fails': resultado simulado do envio ao cliente. */
  applyMode: 'ok' | 'fail' | 'partial'
  latencyMs: number
  /** Envios recebidos pela ponte simulada (para a verificação visual). */
  applied: ApplyBuildRequest[]
  setLcu(s: Partial<LcuStatus>): void
  setDraft(d: Draft | null, epoch?: string): void
  setPlayer(p: PlayerData): void
  setDataStatus(s: Partial<DataStatus>): void
}

export function createMockApi(): LeagueSenseApi {
  ;(window as unknown as { __LS_MOCK__: boolean }).__LS_MOCK__ = true
  const controls = { failStats: false, failBuilds: false, applyMode: 'ok', latencyMs: 60, applied: [] } as unknown as MockControls

  let prefs: Preferences = { ...DEFAULT_PREFERENCES }
  try {
    const saved = localStorage.getItem('ls-mock-prefs')
    if (saved) prefs = { ...prefs, ...JSON.parse(saved) }
  } catch {
    /* sem armazenamento */
  }
  const prefsE = new Emitter<Preferences>()
  const lcuE = new Emitter<LcuStatus>()
  const draftE = new Emitter<DraftUpdate>()
  const playerE = new Emitter<PlayerData>()
  const dataE = new Emitter<DataStatus>()
  let lcu: LcuStatus = { state: 'searching', phase: 'None', lastEventAt: null, attempt: 0, detail: null, region: null }
  let draft: DraftUpdate = { epoch: '', draft: null, updatedAt: 0 }
  let player: PlayerData = { owned: null, mastery: {} }

  // "ao vivo" simulado: mesma API do provedor real, rotulado como opgg-mcp para a interface
  class FakeLive extends DemoProvider {
    override readonly source = 'opgg-mcp' as unknown as 'demo'
    private async gate(): Promise<void> {
      if (controls.latencyMs) await new Promise((r) => setTimeout(r, controls.latencyMs))
      if (controls.failStats) throw new SourceFailure('opgg', 'network', 'falha simulada')
    }
    override async laneMeta() {
      await this.gate()
      return super.laneMeta()
    }
    override async matchups(...a: Parameters<DemoProvider['matchups']>) {
      await this.gate()
      return super.matchups(...a)
    }
    override async synergies(...a: Parameters<DemoProvider['synergies']>) {
      await this.gate()
      return super.synergies(...a)
    }
    override async baseAtTier(...a: Parameters<DemoProvider['baseAtTier']>) {
      await this.gate()
      return super.baseAtTier(...a)
    }
    override async patch() {
      await this.gate()
      return patch
    }
    override async buildGeneral(...a: Parameters<DemoProvider['buildGeneral']>) {
      await this.gate()
      if (controls.failBuilds) throw new SourceFailure('opgg', 'network', 'falha simulada')
      return super.buildGeneral(...a)
    }
    override async matchupGuide(...a: Parameters<DemoProvider['matchupGuide']>) {
      await this.gate()
      if (controls.failBuilds) throw new SourceFailure('opgg', 'network', 'falha simulada')
      return super.matchupGuide(...a)
    }
  }
  const liveProvider = new FakeLive(roster.champions, traits, patch, 0, catalog)
  const demoProvider = new DemoProvider(roster.champions, traits, patch, 100, catalog)
  const live = new StatsService({ provider: liveProvider as never, cache: new MemoryCache(), currentPatch: () => patch, emitIntervalMs: 80 })
  const demo = new StatsService({ provider: demoProvider, cache: new MemoryCache(), currentPatch: () => patch, emitIntervalMs: 80 })
  const tips = ['Dica oficial simulada: respeite o alcance da habilidade principal.', 'Dica oficial simulada: o momento mais fraco é logo depois que ela gasta a mobilidade.']
  const liveBuilds = new BuildService({ provider: liveProvider, cache: new MemoryCache(), catalog: async () => catalog, enemyTips: async () => tips, currentPatch: () => patch })
  const demoBuilds = new BuildService({ provider: demoProvider, cache: new MemoryCache(), catalog: async () => catalog, enemyTips: async () => ['Dica de demonstração (fictícia).'], currentPatch: () => patch })
  const statsUpdate = new Emitter<import('@shared/api').StatsUpdate>()
  for (const s of [live, demo]) {
    s.onUpdate(statsUpdate.emit)
    s.onStatus(dataE.emit)
  }

  const controlsImpl: MockControls = Object.assign(controls, {
    setLcu: (s: Partial<LcuStatus>) => {
      lcu = { ...lcu, ...s }
      lcuE.emit(lcu)
    },
    setDraft: (d: Draft | null, epoch = d?.id ?? '') => {
      draft = { epoch, draft: d, updatedAt: Date.now() }
      draftE.emit(draft)
    },
    setPlayer: (p: PlayerData) => {
      player = p
      playerE.emit(p)
    },
    setDataStatus: (s: Partial<DataStatus>) => dataE.emit({ state: 'ready', progress: null, errors: [], lastUpdated: Date.now(), fromCache: false, demo: false, ...s })
  })
  ;(window as unknown as { __LS__: MockControls }).__LS__ = controlsImpl

  const rosterPayload: RosterPayload = { version: roster.ddragonVersion, patch, champions: roster.champions, source: 'bundled' }

  return {
    app: {
      info: async () => ({ version: '0.1.0-mock', platform: 'browser', userData: '(simulador)', electron: '—', disclaimer: RIOT_DISCLAIMER }),
      openExternal: async () => undefined,
      clearCache: async () => live.reset()
    },
    prefs: {
      get: async () => prefs,
      set: async (p) => {
        prefs = { ...prefs, ...p }
        try {
          localStorage.setItem('ls-mock-prefs', JSON.stringify(prefs))
        } catch {
          /* ignorar */
        }
        prefsE.emit(prefs)
        return prefs
      },
      onChange: prefsE.on
    },
    roster: { get: async () => rosterPayload },
    stats: {
      request: async (plan, mode) => void (await (mode === 'demo' ? demo : live).request(plan)),
      onUpdate: statsUpdate.on,
      onStatus: dataE.on,
      status: async () => live.status(),
      refresh: async () => live.reset()
    },
    builds: {
      request: async (req, mode) => {
        if (controls.latencyMs) await new Promise((r) => setTimeout(r, controls.latencyMs))
        return (mode === 'demo' ? demoBuilds : liveBuilds).get(req)
      }
    },
    lcu: {
      status: async () => lcu,
      onStatus: lcuE.on,
      onDraft: draftE.on,
      currentDraft: async () => draft,
      player: async () => player,
      onPlayer: playerE.on,
      reconnect: async () => undefined,
      applyBuild: async (req): Promise<ApplyResult> => {
        controls.applied.push(req)
        await new Promise((r) => setTimeout(r, 350))
        if (lcu.state !== 'connected') return { ok: false, at: Date.now(), steps: [{ what: 'items', status: 'failed', message: 'O cliente do League of Legends não está conectado. Abra o cliente e tente de novo.' }] }
        const steps = (['items', 'runes', 'spells'] as const)
          .filter((w) => req.options[w])
          .map((w) => {
            if (controls.applyMode === 'fail' || (controls.applyMode === 'partial' && w === 'runes')) return { what: w, status: 'failed' as const, message: `Simulação: o cliente recusou o envio de ${w}.` }
            if (w === 'spells' && lcu.phase !== 'ChampSelect') return { what: w, status: 'skipped' as const, message: 'Feitiços só podem ser trocados durante a seleção de campeões; nada foi alterado.' }
            return { what: w, status: 'ok' as const, message: `Simulação: ${w} enviados ao cliente.` }
          })
        return { ok: steps.every((s) => s.status !== 'failed'), at: Date.now(), steps }
      },
      clearBuilds: async (): Promise<ApplyResult> => ({ ok: true, at: Date.now(), steps: [{ what: 'items', status: 'ok', message: 'Simulação: itens do LeagueSense removidos.' }, { what: 'runes', status: 'ok', message: 'Simulação: página de runas removida.' }] })
    }
  }
}
