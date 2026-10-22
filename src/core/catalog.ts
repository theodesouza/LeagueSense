import type { Catalog, ItemInfo, RuneInfo, SpellInfo, StyleInfo } from './build-types'

/** Reduz os JSON do Data Dragon (item, runesReforged, summoner) ao que o app usa. Puro: roda no build e no app. */

const strip = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Ferimento Grave em pt-BR ("% de Ferimento") e en-US ("Grievous Wounds"). */
const ANTI_HEAL = /\d+%\s*de\s+Ferimento|Grievous Wounds/i

interface RawItem {
  name: string
  plaintext?: string
  description?: string
  tags?: string[]
  gold?: { total: number; purchasable: boolean }
  maps?: Record<string, boolean>
}

export function compactItems(raw: Record<string, RawItem>): Record<number, ItemInfo> {
  const out: Record<number, ItemInfo> = {}
  for (const [id, it] of Object.entries(raw)) {
    const n = Number(id)
    if (!Number.isInteger(n) || n >= 100000) continue // ids de modos especiais (ex.: 32xxxx)
    if (it.maps && it.maps['11'] === false) continue // não existe no Summoner's Rift
    out[n] = {
      id: n,
      name: it.name,
      plain: it.plaintext ? strip(it.plaintext) : '',
      tags: it.tags ?? [],
      gold: it.gold?.total ?? 0,
      antiHeal: ANTI_HEAL.test(strip(it.description ?? ''))
    }
  }
  return out
}

interface RawTree {
  id: number
  key: string
  icon: string
  name: string
  slots: { runes: { id: number; key: string; icon: string; name: string; shortDesc?: string }[] }[]
}

export function compactRunes(raw: RawTree[]): { runes: Record<number, RuneInfo>; styles: Record<number, StyleInfo> } {
  const runes: Record<number, RuneInfo> = {}
  const styles: Record<number, StyleInfo> = {}
  for (const tree of raw) {
    styles[tree.id] = { id: tree.id, name: tree.name, icon: tree.icon }
    for (const slot of tree.slots)
      for (const r of slot.runes) runes[r.id] = { id: r.id, key: r.key, name: r.name, icon: r.icon, styleId: tree.id, short: strip(r.shortDesc ?? '') }
  }
  return { runes, styles }
}

interface RawSpell {
  id: string
  key: string
  name: string
}
export function compactSpells(raw: Record<string, RawSpell>): Record<number, SpellInfo> {
  const out: Record<number, SpellInfo> = {}
  for (const s of Object.values(raw)) {
    const id = Number(s.key)
    if (Number.isInteger(id) && id < 100) out[id] = { id, key: s.id, name: s.name }
  }
  return out
}

export function makeCatalog(
  version: string,
  items: Parameters<typeof compactItems>[0],
  runes: Parameters<typeof compactRunes>[0],
  spells: Parameters<typeof compactSpells>[0]
): Catalog {
  return { version, items: compactItems(items), ...compactRunes(runes), spells: compactSpells(spells) }
}

/** Subconjunto do catálogo com apenas os ids pedidos (o que vai por IPC). */
export function subsetCatalog(c: Catalog, ids: { items: Iterable<number>; runes: Iterable<number>; spells: Iterable<number>; styles: Iterable<number> }): Catalog {
  const pick = <T>(src: Record<number, T>, keys: Iterable<number>): Record<number, T> => {
    const o: Record<number, T> = {}
    for (const k of keys) if (src[k]) o[k] = src[k]
    return o
  }
  return { version: c.version, items: pick(c.items, ids.items), runes: pick(c.runes, ids.runes), spells: pick(c.spells, ids.spells), styles: pick(c.styles, ids.styles) }
}

/** Fragmentos de runa (não vêm no runesReforged): id → nome pt-BR e ícone do Data Dragon. */
export const SHARDS: Record<number, { name: string; icon: string }> = {
  5001: { name: 'Vida escalável', icon: 'perk-images/StatMods/StatModsHealthScalingIcon.png' },
  5002: { name: 'Armadura', icon: 'perk-images/StatMods/StatModsArmorIcon.png' },
  5003: { name: 'Resistência mágica', icon: 'perk-images/StatMods/StatModsMagicResIcon.png' },
  5005: { name: 'Velocidade de ataque', icon: 'perk-images/StatMods/StatModsAttackSpeedIcon.png' },
  5007: { name: 'Aceleração de habilidade', icon: 'perk-images/StatMods/StatModsCDRScalingIcon.png' },
  5008: { name: 'Força adaptativa', icon: 'perk-images/StatMods/StatModsAdaptiveForceIcon.png' },
  5010: { name: 'Velocidade de movimento', icon: 'perk-images/StatMods/StatModsMovementSpeedIcon.png' },
  5011: { name: 'Vida', icon: 'perk-images/StatMods/StatModsHealthPlusIcon.png' },
  5013: { name: 'Tenacidade e resistência a lentidão', icon: 'perk-images/StatMods/StatModsTenacityIcon.png' }
}

/** Itens de visão do arsenal (existem no catálogo atual). */
export const VISION_ITEMS = [3340, 2055] as const
