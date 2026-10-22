import { POSITIONS, type BaseStat, type ChampionInfo, type EloTier, type Position, type PositionRecord } from '@core/types'
import type { Catalog, GeneralBuildData, MatchupGuideData } from '@core/build-types'
import { demoGeneral, demoGuide } from '@core/demo-builds'
import { seededRng } from '@core/rng'
import { traitsFor, type TraitsTable } from '@core/traits'
import type { LaneMeta, StatsProvider, TableEntries } from './provider'

const rng = seededRng

const TIER_SHIFT: Partial<Record<EloTier, number>> = { IRON: -0.006, BRONZE: -0.004, SILVER: -0.002, GOLD: 0, PLATINUM: 0.001, DIAMOND: 0.002, MASTER: 0.003 }

/**
 * Provedor de DEMONSTRAÇÃO. Os números são FICTÍCIOS (gerados de forma determinística) e servem
 * apenas para exercitar a interface sem rede. A interface sempre identifica esse modo.
 */
export class DemoProvider implements StatsProvider {
  readonly source = 'demo' as const
  private readonly positionsOf = new Map<number, Position[]>()

  constructor(
    private readonly roster: ChampionInfo[],
    private readonly traitsTable: TraitsTable,
    private readonly patchLabel: string,
    private readonly latencyMs = 0,
    private readonly catalog: Catalog | null = null
  ) {
    for (const c of roster) {
      const t = traitsTable[c.id]?.positions
      this.positionsOf.set(c.id, t && t.length > 0 ? t : this.guessPositions(c))
    }
  }

  private guessPositions(c: ChampionInfo): Position[] {
    if (c.tags.includes('Marksman')) return ['adc']
    if (c.tags.includes('Support')) return ['support']
    if (c.tags.includes('Assassin')) return ['mid', 'jungle']
    if (c.tags.includes('Mage')) return ['mid']
    if (c.tags.includes('Tank')) return ['top', 'jungle']
    return ['top']
  }

  private async wait(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs))
  }

  private strength(id: number): number {
    return (rng(`s${id}`)() - 0.5) * 0.06 // ±3 pp
  }

  private baseFor(c: ChampionInfo, pos: Position, tier?: EloTier): BaseStat {
    const r = rng(`b${c.id}${pos}`)
    const positions = this.positionsOf.get(c.id) ?? []
    const idx = positions.indexOf(pos)
    const roleRate = positions.length === 0 ? 0.1 : idx === 0 ? 0.82 + r() * 0.15 : idx > 0 ? 0.25 + r() * 0.3 : 0.02
    const play = Math.round(1200 + Math.pow(r(), 2) * 32000)
    const wr = 0.5 + this.strength(c.id) + (tier ? (TIER_SHIFT[tier] ?? 0) : 0)
    return { play, win: Math.round(play * wr), roleRate, pickRate: play / 400000, banRate: r() * 0.12 }
  }

  async laneMeta(): Promise<LaneMeta> {
    await this.wait()
    const byPosition: PositionRecord<Record<number, BaseStat>> = {}
    const roleRates: Record<number, PositionRecord<number>> = {}
    for (const pos of POSITIONS) {
      const table: Record<number, BaseStat> = {}
      for (const c of this.roster) {
        if (!(this.positionsOf.get(c.id) ?? []).includes(pos)) continue
        const s = this.baseFor(c, pos)
        table[c.id] = s
        ;(roleRates[c.id] ??= {})[pos] = s.roleRate
      }
      byPosition[pos] = table
    }
    return { byPosition, roleRates }
  }

  async baseAtTier(champion: number, position: Position, tier: EloTier): Promise<{ stat: BaseStat; patch: string | null }> {
    await this.wait()
    const c = this.roster.find((x) => x.id === champion)
    if (!c) throw new Error('campeão desconhecido')
    return { stat: this.baseFor(c, position, tier), patch: this.patchLabel }
  }

  async matchups(champion: number, position: Position): Promise<TableEntries> {
    await this.wait()
    const entries: TableEntries['entries'] = {}
    for (const o of this.roster) {
      if (o.id === champion || !(this.positionsOf.get(o.id) ?? []).includes(position)) continue
      const r = rng(`m${champion}-${o.id}-${position}`)
      const play = Math.round(30 + Math.pow(r(), 2) * 900)
      const wr = 0.5 + (this.strength(champion) - this.strength(o.id)) + (r() - 0.5) * 0.08
      entries[o.id] = { play, win: Math.round(play * Math.min(0.9, Math.max(0.1, wr))) }
    }
    return { entries, patch: this.patchLabel }
  }

  async synergies(champion: number, mine: Position, ally: Position): Promise<TableEntries> {
    await this.wait()
    const partners = this.roster
      .filter((o) => o.id !== champion && (this.positionsOf.get(o.id) ?? []).includes(ally))
      .map((o) => ({ o, r: rng(`y${champion}-${o.id}-${mine}-${ally}`) }))
      .map(({ o, r }) => ({ id: o.id, lift: (r() - 0.45) * 0.05, play: Math.round(120 + r() * 520) }))
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 10)
    const entries: TableEntries['entries'] = {}
    for (const p of partners) {
      const wr = 0.5 + this.strength(champion) + this.strength(p.id) + p.lift
      entries[p.id] = { play: p.play, win: Math.round(p.play * wr) }
    }
    return { entries, patch: null }
  }

  private traitsOf(id: number): ReturnType<typeof traitsFor> {
    return traitsFor(this.traitsTable, id, this.roster.find((c) => c.id === id)?.tags)
  }

  async buildGeneral(champion: number, _position: Position, _tier: EloTier): Promise<GeneralBuildData> {
    await this.wait()
    if (!this.catalog) throw new Error('catálogo indisponível')
    return demoGeneral(champion, this.traitsOf(champion), this.catalog, this.patchLabel)
  }

  async matchupGuide(champion: number, opponent: number, position: Position): Promise<MatchupGuideData> {
    await this.wait()
    if (!this.catalog) throw new Error('catálogo indisponível')
    return demoGuide(champion, opponent, position, this.traitsOf(champion), this.catalog, this.patchLabel)
  }

  async patch(): Promise<string | null> {
    await this.wait()
    return this.patchLabel
  }
}
