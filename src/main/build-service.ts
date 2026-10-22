import { VISION_ITEMS, subsetCatalog } from '@core/catalog'
import type { BuildBundle, Catalog, GeneralBuildData, ItemSet, MatchupGuideData, RunePage } from '@core/build-types'
import { DEFAULT_AGGREGATE_TIER, type EloTier, type Position } from '@core/types'
import type { CacheStore } from './cache'
import { toSourceError } from './errors'
import type { StatsProvider } from './sources/provider'

const HOUR = 3_600_000
export const BUILD_TTL = { general: 6 * HOUR, guide: 12 * HOUR } as const

export interface BuildRequest {
  champion: number
  position: Position
  elo: EloTier
  /** Oponente de rota mais provável (null = ainda não há inimigo). */
  opponent: number | null
}

interface Deps {
  provider: StatsProvider
  cache: CacheStore
  /** Catálogo de itens/runas/feitiços (pt-BR). null = indisponível. */
  catalog: () => Promise<Catalog | null>
  /** Dicas oficiais da Riot para enfrentar o campeão (chave do Data Dragon). */
  enemyTips: (championId: number) => Promise<string[]>
  currentPatch?: () => string | null
  now?: () => number
}

interface Loaded<T> {
  value: T
  fetchedAt: number
  fromCache: boolean
}

/** Feitiços que o planejador pode acrescentar além dos que vêm do provedor. */
const PLANNER_SPELLS = [1, 3, 4, 6, 7, 11, 12, 14, 21]

const setIds = (sets: Iterable<ItemSet | null | undefined>): number[] => {
  const out: number[] = []
  for (const s of sets) if (s) out.push(...s.ids)
  return out
}
const runeIds = (pages: Iterable<RunePage | null | undefined>): { runes: number[]; styles: number[] } => {
  const runes: number[] = []
  const styles: number[] = []
  for (const p of pages) if (p) {
    runes.push(...p.primaryRunes, ...p.secondaryRunes)
    styles.push(p.primaryStyle, p.secondaryStyle)
  }
  return { runes, styles }
}

/**
 * Reúne os dados de build de um campeão: builds gerais, guia do confronto, dicas da Riot e o
 * catálogo. Cada parte falha sozinha (o restante segue), e o resultado informa o que faltou.
 */
export class BuildService {
  private readonly now: () => number
  private readonly inflight = new Map<string, Promise<BuildBundle>>()

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now
  }

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<Loaded<T>> {
    const now = this.now()
    const disk = await this.deps.cache.get<T>(key)
    if (disk && now - disk.fetchedAt <= ttl) return { value: disk.value, fetchedAt: disk.fetchedAt, fromCache: true }
    try {
      const value = await load()
      await this.deps.cache.set(key, value, now)
      return { value, fetchedAt: now, fromCache: false }
    } catch (e) {
      if (disk) return { value: disk.value, fetchedAt: disk.fetchedAt, fromCache: true } // fonte falhou: serve o cache vencido
      throw e
    }
  }

  get(req: BuildRequest): Promise<BuildBundle> {
    const key = this.keyOf(req)
    const cur = this.inflight.get(key)
    if (cur) return cur
    const p = this.build(req, key).finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  keyOf(r: BuildRequest): string {
    return `${this.deps.provider.source}:${r.position}:${r.elo}:${r.champion}:${r.opponent ?? 'none'}`
  }

  private async build(req: BuildRequest, key: string): Promise<BuildBundle> {
    const { provider } = this.deps
    const src = provider.source
    const problems: BuildBundle['problems'] = []
    const fail = (e: unknown, what: string): void => {
      const d = toSourceError(e, 'opgg', this.now())
      problems.push({ message: `${what}: ${d.message}`, ...(d.action ? { action: d.action } : {}) })
    }

    const [generalR, guideR, tipsR, catalogR] = await Promise.allSettled([
      this.cached<GeneralBuildData>(`bgen:${src}:${req.elo}:${req.position}:${req.champion}`, BUILD_TTL.general, () => provider.buildGeneral(req.champion, req.position, req.elo)),
      req.opponent != null
        ? this.cached<MatchupGuideData>(`bguide:${src}:${req.position}:${req.champion}:${req.opponent}`, BUILD_TTL.guide, () => provider.matchupGuide(req.champion, req.opponent!, req.position))
        : Promise.resolve(null),
      req.opponent != null ? this.deps.enemyTips(req.opponent) : Promise.resolve([] as string[]),
      this.deps.catalog()
    ])

    let general: Loaded<GeneralBuildData> | null = null
    let guide: Loaded<MatchupGuideData> | null = null
    if (generalR.status === 'fulfilled') general = generalR.value
    else fail(generalR.reason, 'Builds do campeão')
    if (guideR.status === 'fulfilled') guide = guideR.value
    else fail(guideR.reason, 'Guia do confronto')
    const opponentTips = tipsR.status === 'fulfilled' ? tipsR.value : []
    const catalogFull = catalogR.status === 'fulfilled' ? catalogR.value : null
    if (!catalogFull) problems.push({ message: 'Catálogo de itens indisponível: nomes de itens podem aparecer em inglês.' })

    const g = general?.value ?? null
    const m = guide?.value ?? null
    const items = [
      ...setIds([g?.core, g?.boots, g?.starter, ...(g?.slot4 ?? []), ...(g?.slot5 ?? []), ...(g?.slot6 ?? [])]),
      ...setIds([...(m?.cores ?? []), ...(m?.boots ?? []), ...(m?.starters ?? []), ...(m?.singles.flat() ?? [])]),
      ...VISION_ITEMS
    ]
    const rr = runeIds([g?.runes, ...(m?.runes ?? [])])
    const spells = [...setIds([g?.spells, ...(m?.spells ?? [])]), ...PLANNER_SPELLS]
    const catalog = catalogFull ? subsetCatalog(catalogFull, { items, runes: rr.runes, styles: rr.styles, spells }) : null

    const parts = [general, guide].filter((x): x is Loaded<GeneralBuildData> | Loaded<MatchupGuideData> => !!x)
    return {
      key,
      champion: req.champion,
      position: req.position,
      opponent: req.opponent,
      general: g ? { ...g, fetchedAt: general!.fetchedAt } : null,
      guide: m ? { ...m, fetchedAt: guide!.fetchedAt } : null,
      opponentTips,
      catalog,
      provenance: {
        source: src,
        patch: g?.patch ?? m?.patch ?? null,
        currentPatch: this.deps.currentPatch?.() ?? null,
        tier: req.elo,
        guideTier: DEFAULT_AGGREGATE_TIER,
        fetchedAt: parts.length > 0 ? Math.min(...parts.map((p) => p.fetchedAt)) : null,
        fromCache: parts.length > 0 && parts.some((p) => p.fromCache)
      },
      problems
    }
  }
}

