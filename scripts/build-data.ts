/**
 * Gera dados embutidos (roster e traços de composição) a partir de:
 *  - Data Dragon (oficial): nomes pt-BR/en-US, tags, ids;
 *  - Meraki Analytics `lolstaticdata` (comunidade): funções e atributos para derivar traços;
 *  - scripts/trait-overrides.json (curadoria manual).
 * Executar: npm run build:data   (requer rede)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { deriveTraits, type ChampionTraits } from '../src/core/traits'

const here = __dirname
const out = resolve(here, '../src/core/data')
mkdirSync(out, { recursive: true })

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

interface DDChampion { id: string; key: string; name: string; tags: string[] }
interface MerakiChampion {
  adaptiveType: string
  attackType: string
  roles: string[]
  positions: string[]
  attributeRatings: { damage: number; toughness: number; control: number; mobility: number; utility: number }
}
interface Overrides {
  engage: Record<string, number>
  peel: Record<string, number>
  disengage: Record<string, number>
  dive: Record<string, number>
  hypercarry: string[]
  damageSplit: Record<string, number>
}

async function main(): Promise<void> {
  const versions = await getJson<string[]>('https://ddragon.leagueoflegends.com/api/versions.json')
  const version = versions[0]!
  const [pt, en, meraki] = await Promise.all([
    getJson<{ data: Record<string, DDChampion> }>(`https://ddragon.leagueoflegends.com/cdn/${version}/data/pt_BR/champion.json`),
    getJson<{ data: Record<string, DDChampion> }>(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`),
    getJson<Record<string, MerakiChampion>>('https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json')
  ])
  const overrides = JSON.parse(readFileSync(resolve(here, 'trait-overrides.json'), 'utf8')) as Overrides

  const roster = Object.values(pt.data)
    .map((c) => ({ id: Number(c.key), key: c.id, name: c.name, nameEn: en.data[c.id]?.name ?? c.name, tags: c.tags }))
    .sort((a, b) => a.id - b.id)

  const traits: Record<number, ChampionTraits> = {}
  const missing: string[] = []
  for (const c of roster) {
    const m = meraki[c.key]
    if (!m) {
      missing.push(c.key)
      continue
    }
    const t = deriveTraits({
      adaptive: m.adaptiveType,
      attackType: m.attackType,
      roles: m.roles,
      ratings: m.attributeRatings,
      positions: m.positions
    })
    let curated = false
    const set = <K extends 'engage' | 'peel' | 'disengage' | 'dive'>(k: K): void => {
      const v = overrides[k][c.key]
      if (v != null) {
        t[k] = v
        curated = true
      }
    }
    set('engage')
    set('peel')
    set('disengage')
    set('dive')
    if (overrides.hypercarry.includes(c.key)) {
      t.hypercarry = true
      curated = true
    }
    const split = overrides.damageSplit[c.key]
    if (split != null) {
      t.ad = split
      t.ap = 1 - split
      curated = true
    }
    if (curated) t.source = 'curated'
    traits[c.id] = t
  }

  const meta = { ddragonVersion: version, generatedAt: new Date().toISOString(), traitsWithoutSource: missing }
  writeFileSync(resolve(out, 'roster.json'), JSON.stringify({ ...meta, champions: roster }, null, 1))
  writeFileSync(resolve(out, 'traits.json'), JSON.stringify({ ...meta, traits }, null, 1))
  console.log(`Data Dragon ${version}: ${roster.length} campeões; traços derivados: ${Object.keys(traits).length}; sem Meraki: ${missing.join(', ') || '—'}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
