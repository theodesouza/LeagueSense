import { DEFAULT_AGGREGATE_TIER, POSITIONS, type BaseStat, type EloTier, type Position, type PositionRecord, type StatsSnapshot, type MatchupTable, type SynergyTable } from '@core/types'
import type { FetchPlan } from '@core/fetch-plan'
import type { DataStatus, SourceError, StatsUpdate } from '@shared/api'
import type { CacheStore } from './cache'
import { toSourceError } from './errors'
import type { StatsProvider, LaneMeta } from './sources/provider'

const HOUR = 3_600_000
export const TTL = { meta: 3 * HOUR, table: 12 * HOUR, base: 6 * HOUR } as const

interface Stored<T> {
  value: T
  fetchedAt: number
  fromCache: boolean
}

interface Deps {
  provider: StatsProvider
  cache: CacheStore
  now?: () => number
  /** Patch atual do jogo (Data Dragon), para detectar defasagem. */
  currentPatch?: () => string | null
  /** Limite de itens em paralelo por requisição (o cliente MCP aplica o limite global). */
  parallel?: number
  /** Intervalo mínimo entre emissões de atualização (ms). */
  emitIntervalMs?: number
}

type Listener<T> = (v: T) => void

/**
 * Orquestra as buscas de estatísticas: cache em memória → disco → provedor, com chamadas
 * deduplicadas, progresso, tolerância a falhas por item e instantâneos versionados por contexto.
 *
 * Proteção contra respostas fora de ordem: os resultados são guardados por CHAVE DE DADO
 * (patch/posição/campeão), nunca "por requisição". Um instantâneo só inclui o que pertence ao
 * contexto pedido; respostas atrasadas de outro contexto ficam no repositório mas não aparecem.
 */
export class StatsService {
  private readonly provider: StatsProvider
  private readonly cache: CacheStore
  private readonly now: () => number
  private readonly currentPatch: () => string | null
  private readonly parallel: number
  private readonly emitIntervalMs: number

  private meta: Stored<LaneMeta> | null = null
  private patch: string | null = null
  private readonly tables = new Map<string, Stored<MatchupTable | SynergyTable>>()
  private readonly bases = new Map<string, Stored<BaseStat>>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  private version = 0
  private generation = 0
  private errors: SourceError[] = []
  private progress: { done: number; total: number } | null = null
  private loading = 0
  private lastUpdated: number | null = null
  private context: { position: Position; elo: EloTier } | null = null

  private updateListeners = new Set<Listener<StatsUpdate>>()
  private statusListeners = new Set<Listener<DataStatus>>()
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private lastEmit = 0

  constructor(deps: Deps) {
    this.provider = deps.provider
    this.cache = deps.cache
    this.now = deps.now ?? Date.now
    this.currentPatch = deps.currentPatch ?? ((): string | null => null)
    this.parallel = deps.parallel ?? 3
    this.emitIntervalMs = deps.emitIntervalMs ?? 250
  }

  onUpdate(cb: Listener<StatsUpdate>): () => void {
    this.updateListeners.add(cb)
    return () => this.updateListeners.delete(cb)
  }
  onStatus(cb: Listener<DataStatus>): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  contextKey(position: Position, elo: EloTier): string {
    return `${this.provider.source}:${position}:${elo}`
  }

  status(): DataStatus {
    const hasData = this.meta != null
    let state: DataStatus['state']
    if (!hasData) state = this.loading > 0 ? 'loading' : this.errors.length > 0 ? 'error' : 'idle'
    else state = this.errors.length > 0 ? 'partial' : 'ready'
    return {
      state,
      progress: this.progress,
      errors: this.errors.slice(-5),
      lastUpdated: this.lastUpdated,
      fromCache: hasData && this.meta!.fromCache,
      demo: this.provider.source === 'demo'
    }
  }

  /* ---------------------------- armazenamento ---------------------------- */

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<Stored<T>> {
    const now = this.now()
    const disk = await this.cache.get<T>(key)
    if (disk && now - disk.fetchedAt <= ttl) return { value: disk.value, fetchedAt: disk.fetchedAt, fromCache: true }
    try {
      const value = await load()
      await this.cache.set(key, value, now)
      return { value, fetchedAt: now, fromCache: false }
    } catch (e) {
      // fonte falhou: serve o cache mesmo vencido (marcado como cache/defasado)
      if (disk) return { value: disk.value, fetchedAt: disk.fetchedAt, fromCache: true }
      throw e
    }
  }

  private single<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const p = run().finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  private recordError(e: unknown): void {
    const err = toSourceError(e, 'opgg', this.now())
    if (!this.errors.some((x) => x.kind === err.kind && x.message === err.message)) this.errors.push(err)
    if (this.errors.length > 20) this.errors.shift()
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.loading++
    this.emitStatus()
    return p.finally(() => {
      this.loading--
      this.emitStatus()
    })
  }

  /* ------------------------------ buscas ------------------------------ */

  private async loadMeta(): Promise<void> {
    await this.single('meta', async () => {
      if (this.meta && this.now() - this.meta.fetchedAt <= TTL.meta) return // já temos (e foi buscado nesta sessão ou lido do disco antes)
      const s = await this.cached<LaneMeta>(`meta:${this.provider.source}`, TTL.meta, () => this.provider.laneMeta())
      this.meta = s
      this.lastUpdated = Math.max(this.lastUpdated ?? 0, s.fetchedAt)
    })
  }

  private async loadPatch(champion: number, position: Position): Promise<void> {
    if (this.patch) return
    await this.single('patch', async () => {
      if (this.patch) return
      const s = await this.cached<string | null>(`patch:${this.provider.source}`, TTL.base, async () => {
        const v = await this.provider.patch({ champion, position })
        if (!v) throw new Error('patch indisponível') // nunca guardar "sem patch" no cache
        return v
      })
      this.patch = s.value
    })
  }

  private async loadMatchup(champion: number, position: Position): Promise<void> {
    const key = `m:${champion}:${position}`
    await this.single(key, async () => {
      const cur = this.tables.get(key)
      if (cur && this.now() - cur.fetchedAt <= TTL.table) return
      const s = await this.cached(`matchup:${this.provider.source}:${champion}:${position}`, TTL.table, async () => {
        const t = await this.provider.matchups(champion, position)
        return { entries: t.entries, patch: t.patch, fetchedAt: this.now() } satisfies MatchupTable
      })
      this.tables.set(key, s)
      if (!this.patch && (s.value as MatchupTable).patch) this.patch = (s.value as MatchupTable).patch ?? null
    })
  }

  private async loadSynergy(champion: number, mine: Position, ally: Position): Promise<void> {
    const key = `s:${champion}:${mine}:${ally}`
    await this.single(key, async () => {
      const cur = this.tables.get(key)
      if (cur && this.now() - cur.fetchedAt <= TTL.table) return
      const s = await this.cached(`synergy:${this.provider.source}:${champion}:${mine}:${ally}`, TTL.table, async () => {
        const t = await this.provider.synergies(champion, mine, ally)
        return { entries: t.entries, fetchedAt: this.now() } satisfies SynergyTable
      })
      this.tables.set(key, s)
    })
  }

  private async loadBase(champion: number, position: Position, tier: EloTier): Promise<void> {
    const key = `b:${tier}:${position}:${champion}`
    await this.single(key, async () => {
      const cur = this.bases.get(key)
      if (cur && this.now() - cur.fetchedAt <= TTL.base) return
      const s = await this.cached(`base:${this.provider.source}:${tier}:${position}:${champion}`, TTL.base, async () => {
        const r = await this.provider.baseAtTier(champion, position, tier)
        return r.stat
      })
      this.bases.set(key, s)
    })
  }

  /** Executa tarefas com paralelismo limitado e cancela o restante se uma nova requisição chegar. */
  private async pool(tasks: (() => Promise<void>)[], generation: number): Promise<void> {
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        if (generation !== this.generation) return // requisição substituída: não inicia novos itens
        const i = next++
        const task = tasks[i]
        if (!task) return
        try {
          await task()
          if (this.progress) this.progress.done++
        } catch (e) {
          this.recordError(e)
          if (this.progress) this.progress.done++
        }
        this.scheduleEmit()
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.parallel, tasks.length) }, worker))
  }

  /**
   * Carrega o necessário para o plano. Retorna quando termina (ou é substituída por outra
   * requisição). Dados parciais vão sendo publicados via onUpdate.
   */
  async request(plan: FetchPlan): Promise<void> {
    const generation = ++this.generation
    this.context = { position: plan.position, elo: plan.elo }
    this.errors = []
    await this.track(this.run(plan, generation))
    if (generation === this.generation) {
      this.progress = null
      this.emitNow()
    }
  }

  private async run(plan: FetchPlan, generation: number): Promise<void> {
    try {
      await this.loadMeta()
    } catch (e) {
      this.recordError(e)
      this.emitNow()
      return
    }
    this.emitNow()
    if (generation !== this.generation) return

    const meta = this.meta!.value
    const posTable = meta.byPosition[plan.position] ?? {}
    const probe = plan.matchups[0] ?? Number(Object.keys(posTable)[0])

    const tasks: (() => Promise<void>)[] = []
    // o patch é buscado em paralelo com as tabelas (não atrasa o início delas); as tabelas também o informam
    if (probe && !this.patch) tasks.push(() => this.loadPatch(probe, plan.position))
    if (plan.elo !== DEFAULT_AGGREGATE_TIER) {
      for (const c of plan.extraBase) tasks.push(() => this.loadBase(c, plan.position, plan.elo))
    }
    // por candidato, em ordem de prioridade: confronto e depois sinergias — os melhores ficam completos primeiro
    for (const c of plan.matchups) {
      tasks.push(() => this.loadMatchup(c, plan.position))
      for (const s of plan.synergies) if (s.champion === c) tasks.push(() => this.loadSynergy(s.champion, plan.position, s.allyPosition))
    }
    this.progress = { done: 0, total: tasks.length }
    this.emitNow()
    await this.pool(tasks, generation)
  }

  /** Descarta caches e memória; a próxima requisição busca de novo. */
  async reset(): Promise<void> {
    this.generation++
    this.meta = null
    this.patch = null
    this.tables.clear()
    this.bases.clear()
    this.inflight.clear()
    this.errors = []
    this.progress = null
    this.lastUpdated = null
    await this.cache.clear()
    this.emitNow()
  }

  /* ----------------------------- instantâneo ----------------------------- */

  snapshot(position: Position, elo: EloTier): StatsSnapshot | null {
    if (!this.meta) return null
    const meta = this.meta.value
    const isDefault = elo === DEFAULT_AGGREGATE_TIER
    let fetchedAt = this.meta.fetchedAt
    let fromCache = this.meta.fromCache

    const base: PositionRecord<Record<number, BaseStat>> = {}
    if (isDefault) {
      base[position] = meta.byPosition[position] ?? {}
    } else {
      const t: Record<number, BaseStat> = {}
      for (const [key, s] of this.bases) {
        const [, tier, pos, champ] = key.split(':')
        if (tier === elo && pos === position) {
          t[Number(champ)] = s.value
          fetchedAt = Math.min(fetchedAt, s.fetchedAt)
          fromCache ||= s.fromCache
        }
      }
      base[position] = t
    }

    const matchups: Record<string, MatchupTable> = {}
    const synergies: Record<string, SynergyTable> = {}
    for (const [key, s] of this.tables) {
      const [kind, champ, a, b] = key.split(':')
      if (kind === 'm' && a === position) {
        matchups[`${champ}:${a}`] = s.value as MatchupTable
      } else if (kind === 's' && a === position) {
        synergies[`${champ}:${a}:${b}`] = s.value as SynergyTable
      } else continue
      fetchedAt = Math.min(fetchedAt, s.fetchedAt)
      fromCache ||= s.fromCache
    }

    return {
      provenance: {
        source: this.provider.source,
        patch: this.patch,
        currentPatch: this.currentPatch(),
        tier: elo,
        tableTier: DEFAULT_AGGREGATE_TIER,
        region: 'global',
        queue: 'ranked-solo-duo',
        fetchedAt,
        fromCache
      },
      base,
      baseDefault: meta.byPosition,
      roleRates: meta.roleRates,
      matchups,
      synergies
    }
  }

  /* ------------------------------- emissões ------------------------------- */

  private emitStatus(): void {
    const s = this.status()
    for (const l of this.statusListeners) l(s)
  }

  private scheduleEmit(): void {
    const wait = this.lastEmit + this.emitIntervalMs - this.now()
    if (wait <= 0) return this.emitNow()
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null
      this.emitNow()
    }, wait)
  }

  private emitNow(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.lastEmit = this.now()
    this.emitStatus()
    if (!this.context) return
    const { position, elo } = this.context
    const update: StatsUpdate = { contextKey: this.contextKey(position, elo), version: ++this.version, snapshot: this.snapshot(position, elo) }
    for (const l of this.updateListeners) l(update)
  }

  /** Para a interface obter o instantâneo atual sob demanda. */
  current(position: Position, elo: EloTier): StatsUpdate {
    return { contextKey: this.contextKey(position, elo), version: this.version, snapshot: this.snapshot(position, elo) }
  }
}

export { POSITIONS }
