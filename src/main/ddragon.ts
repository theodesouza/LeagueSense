import { z } from 'zod'
import type { Catalog } from '@core/build-types'
import { makeCatalog } from '@core/catalog'
import type { ChampionInfo } from '@core/types'
import type { RosterPayload } from '@shared/api'
import type { CacheStore } from './cache'
import { SourceFailure } from './errors'
import { httpJson } from './http'

const BASE = 'https://ddragon.leagueoflegends.com'

const VersionsSchema = z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).min(1)
const ChampionFile = z.object({
  version: z.string(),
  data: z.record(
    z.string(),
    z.object({ id: z.string().min(1), key: z.string().regex(/^\d+$/), name: z.string().min(1), tags: z.array(z.string()) })
  )
})

export interface BundledRoster {
  ddragonVersion: string
  champions: ChampionInfo[]
}

interface Deps {
  cache: CacheStore
  bundled: BundledRoster
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** "16.21.1" → "16.21" */
export const patchOf = (version: string | null): string | null => (version ? version.split('.').slice(0, 2).join('.') : null)

/** Lista de campeões (pt-BR + nomes em inglês) do Data Dragon, com cache e alternativa embutida. */
export class DataDragon {
  private current: RosterPayload | null = null
  constructor(private readonly deps: Deps) {}

  get version(): string | null {
    return this.current?.version ?? this.deps.bundled.ddragonVersion
  }
  get patch(): string | null {
    return patchOf(this.version)
  }

  private http() {
    return {
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
      timeoutMs: 12_000
    }
  }

  async roster(): Promise<RosterPayload> {
    const now = (this.deps.now ?? Date.now)()
    let versions: string[] | null = null
    try {
      const raw = await httpJson<unknown>('ddragon', `${BASE}/api/versions.json`, this.http())
      const r = VersionsSchema.safeParse(raw)
      if (!r.success) throw new SourceFailure('ddragon', 'validation', 'versions.json inesperado')
      versions = r.data
      await this.deps.cache.set('ddragon:versions', versions, now)
    } catch {
      versions = (await this.deps.cache.get<string[]>('ddragon:versions'))?.value ?? null
    }

    const version = versions?.[0] ?? null
    if (version) {
      const key = `ddragon:roster:${version}`
      const cached = await this.deps.cache.get<ChampionInfo[]>(key)
      if (cached && cached.value.length > 0) {
        return (this.current = { version, patch: patchOf(version), champions: cached.value, source: 'cache' })
      }
      try {
        const [pt, en] = await Promise.all([
          httpJson<unknown>('ddragon', `${BASE}/cdn/${version}/data/pt_BR/champion.json`, this.http()),
          httpJson<unknown>('ddragon', `${BASE}/cdn/${version}/data/en_US/champion.json`, this.http())
        ])
        const ptP = ChampionFile.safeParse(pt)
        const enP = ChampionFile.safeParse(en)
        if (!ptP.success || !enP.success) throw new SourceFailure('ddragon', 'validation', 'champion.json inesperado')
        const champions: ChampionInfo[] = Object.values(ptP.data.data)
          .map((c) => ({
            id: Number(c.key),
            key: c.id,
            name: c.name,
            nameEn: enP.data.data[c.id]?.name ?? c.name,
            tags: c.tags
          }))
          .sort((a, b) => a.id - b.id)
        await this.deps.cache.set(key, champions, now)
        return (this.current = { version, patch: patchOf(version), champions, source: 'live' })
      } catch {
        // cai para a lista embutida abaixo
      }
    }
    const b = this.deps.bundled
    return (this.current = { version: b.ddragonVersion, patch: patchOf(b.ddragonVersion), champions: b.champions, source: 'bundled' })
  }

  /** Catálogo de itens/runas/feitiços (pt-BR) do patch atual: ao vivo → cache → embutido. */
  async catalog(bundled: Catalog): Promise<{ catalog: Catalog; source: 'live' | 'cache' | 'bundled' }> {
    const version = this.current?.version ?? (await this.roster()).version
    const now = (this.deps.now ?? Date.now)()
    if (version) {
      const key = `ddragon:catalog:${version}`
      const cached = await this.deps.cache.get<Catalog>(key)
      if (cached?.value?.items && Object.keys(cached.value.items).length > 50) return { catalog: cached.value, source: 'cache' }
      try {
        const base = `${BASE}/cdn/${version}/data/pt_BR`
        const [items, runes, spells] = await Promise.all([
          httpJson<{ data?: Record<string, never> }>('ddragon', `${base}/item.json`, this.http()),
          httpJson<unknown[]>('ddragon', `${base}/runesReforged.json`, this.http()),
          httpJson<{ data?: Record<string, never> }>('ddragon', `${base}/summoner.json`, this.http())
        ])
        if (!items.data || !Array.isArray(runes) || !spells.data) throw new SourceFailure('ddragon', 'validation', 'catálogo inesperado')
        const catalog = makeCatalog(version, items.data, runes as never, spells.data)
        if (Object.keys(catalog.items).length < 50) throw new SourceFailure('ddragon', 'validation', 'catálogo vazio')
        await this.deps.cache.set(key, catalog, now)
        return { catalog, source: 'live' }
      } catch {
        /* recua para o embutido */
      }
    }
    return { catalog: bundled, source: 'bundled' }
  }

  /** Dicas oficiais (pt-BR) para enfrentar um campeão. Vazio se indisponível. */
  async enemyTips(key: string): Promise<string[]> {
    if (!/^[A-Za-z0-9]{1,32}$/.test(key)) return []
    const version = this.current?.version ?? (await this.roster()).version
    if (!version) return []
    const ck = `ddragon:tips:${version}:${key}`
    const cached = await this.deps.cache.get<string[]>(ck)
    if (cached) return cached.value
    try {
      const raw = await httpJson<unknown>('ddragon', `${BASE}/cdn/${version}/data/pt_BR/champion/${key}.json`, this.http())
      const parsed = z.object({ data: z.record(z.string(), z.object({ enemytips: z.array(z.string()).default([]) })) }).safeParse(raw)
      const tips = parsed.success ? (Object.values(parsed.data.data)[0]?.enemytips ?? []).map((t) => t.trim()).filter(Boolean) : []
      await this.deps.cache.set(ck, tips, (this.deps.now ?? Date.now)())
      return tips
    } catch {
      return []
    }
  }
}
