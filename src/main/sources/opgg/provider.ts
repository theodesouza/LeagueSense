import { SourceFailure } from '../../errors'
import type { GeneralBuildData, ItemSet, LaneSide, MatchupGuideData, RunePage, SkillPlan } from '@core/build-types'
import type { BaseStat, EloTier, Position, PositionRecord } from '@core/types'
import { POSITIONS } from '@core/types'
import type { StatsProvider, LaneMeta, TableEntries } from '../provider'
import { parseDsl } from './dsl'
import type { McpLike } from './mcp'
import { AnalysisBaseSchema, ChampionListSchema, GeneralBuildSchema, GuideBuildSchema, LaneMetaSchema, MatchupGuideSchema, PatchProbeSchema, SynergySchema, type ItemSetRawT, type RunesRawT } from './schemas'
import type { ZodType } from 'zod'

/** "LeeSin" → "LEE_SIN", "KSante" → "K_SANTE" (formato aceito pelo servidor; ele ignora os "_"). */
export function opggParam(ddragonKey: string): string {
  return ddragonKey
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toUpperCase()
}

export const normalizeName = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]/g, '')

const DEFAULT_OPPONENT: Record<Position, string> = {
  top: 'GAREN',
  jungle: 'LEE_SIN',
  mid: 'AHRI',
  adc: 'JINX',
  support: 'LEONA'
}

function validate<T>(schema: ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value)
  if (!r.success) {
    throw new SourceFailure('opgg', 'validation', `${what}: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
  }
  return r.data
}

function parseText(text: string): unknown {
  try {
    return parseDsl(text)
  } catch (e) {
    throw new SourceFailure('opgg', 'parse', 'formato do OP.GG não reconhecido', { cause: e })
  }
}

function firstPatch(w: { version: string } | { version: string }[] | undefined): string | null {
  if (!w) return null
  const v = Array.isArray(w) ? w[0]?.version : w.version
  return v ?? null
}

interface RosterMaps {
  byName: Map<string, number>
  keyById: Map<number, string>
  nameById: Map<number, string>
}

const toItemSet = (r: ItemSetRawT): ItemSet => ({ ids: r.ids, names: (r.ids_names ?? []).map(String), play: r.play, win: r.win, pick: r.pick_rate ?? 0 })
const toRunePage = (r: RunesRawT): RunePage => ({ primaryStyle: r.primary_page_id, primaryRunes: r.primary_rune_ids, secondaryStyle: r.secondary_page_id, secondaryRunes: r.secondary_rune_ids, shards: r.stat_mod_ids, play: r.play, win: r.win })
const DAMAGE: Record<string, 'AD' | 'AP' | 'BOTH'> = { AD: 'AD', AP: 'AP', BOTH: 'BOTH' }

export class OpggProvider implements StatsProvider {
  readonly source = 'opgg-mcp' as const
  private maps: Promise<RosterMaps> | null = null
  /** Nomes da lista de rotas que não casaram com o roster (diagnóstico). */
  unmatched = new Set<string>()

  constructor(private readonly mcp: McpLike) {}

  private async roster(): Promise<RosterMaps> {
    if (!this.maps) {
      this.maps = (async () => {
        const text = await this.mcp.callTool('lol_list_champions', { desired_output_fields: ['data.champions[].{champion_id,key,name}'] })
        const parsed = validate(ChampionListSchema, parseText(text), 'lista de campeões')
        const byName = new Map<string, number>()
        const keyById = new Map<number, string>()
        const nameById = new Map<number, string>()
        for (const c of parsed.data.champions) {
          // ignora variantes de modos especiais (ex.: "Jade_Annie", ids ≥ 60000)
          if (c.champion_id >= 60000 || c.key.includes('_')) continue
          byName.set(normalizeName(c.name), c.champion_id)
          keyById.set(c.champion_id, c.key)
          nameById.set(c.champion_id, c.name)
        }
        return { byName, keyById, nameById }
      })().catch((e) => {
        this.maps = null
        throw e
      })
    }
    return this.maps
  }

  private async param(champion: number): Promise<string> {
    const { keyById } = await this.roster()
    const key = keyById.get(champion)
    if (!key) throw new SourceFailure('opgg', 'validation', `campeão ${champion} desconhecido para o OP.GG`)
    return opggParam(key)
  }

  async laneMeta(): Promise<LaneMeta> {
    const { byName } = await this.roster()
    const fields = POSITIONS.map((p) => `data.positions.${p}[].{champion,play,win,pick_rate,role_rate,ban_rate}`)
    const text = await this.mcp.callTool('lol_list_lane_meta_champions', { position: 'all', desired_output_fields: fields })
    const parsed = validate(LaneMetaSchema, parseText(text), 'lista por rota')
    const byPosition: PositionRecord<Record<number, BaseStat>> = {}
    const roleRates: Record<number, PositionRecord<number>> = {}
    for (const pos of POSITIONS) {
      const table: Record<number, BaseStat> = {}
      for (const row of parsed.data.positions[pos]) {
        const id = byName.get(normalizeName(row.champion))
        if (id == null) {
          this.unmatched.add(row.champion)
          continue
        }
        table[id] = { play: row.play, win: row.win, roleRate: row.role_rate, pickRate: row.pick_rate, banRate: row.ban_rate }
        ;(roleRates[id] ??= {})[pos] = row.role_rate
      }
      byPosition[pos] = table
    }
    return { byPosition, roleRates }
  }

  async baseAtTier(champion: number, position: Position, tier: EloTier): Promise<{ stat: BaseStat; patch: string | null }> {
    const text = await this.mcp.callTool('lol_get_champion_analysis', {
      game_mode: 'ranked',
      champion: await this.param(champion),
      position,
      tier,
      desired_output_fields: ['data.summary.positions[].{name,stats.{play,win_rate,role_rate,pick_rate,ban_rate}}', 'data.trends.win']
    })
    const parsed = validate(AnalysisBaseSchema, parseText(text), 'análise do campeão')
    const row = parsed.data.summary.positions.find((p) => p.name.toLowerCase() === position) ?? parsed.data.summary.positions[0]
    if (!row) throw new SourceFailure('opgg', 'validation', 'análise sem a posição pedida')
    const { play, win_rate } = row.stats
    return {
      // o servidor arredonda a taxa a 2 casas; reconstruímos as vitórias e sinalizamos
      stat: { play, win: Math.round(play * win_rate), roleRate: row.stats.role_rate, pickRate: row.stats.pick_rate, banRate: row.stats.ban_rate, rounded: true },
      patch: firstPatch(parsed.data.trends?.win)
    }
  }

  async matchups(champion: number, position: Position): Promise<TableEntries> {
    const opponent = DEFAULT_OPPONENT[position]
    const mine = await this.param(champion)
    const text = await this.mcp.callTool('lol_get_lane_matchup_guide', {
      position,
      my_champion: mine,
      opponent_champion: opponent === mine ? 'ANNIE' : opponent
    })
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (e) {
      throw new SourceFailure('opgg', 'parse', 'guia de confronto não é JSON', { cause: e })
    }
    const parsed = validate(MatchupGuideSchema, json, 'guia de confronto')
    const entries: Record<number, { play: number; win: number }> = {}
    for (const c of parsed.data.counters) if (c.play > 0) entries[c.champion_id] = { play: c.play, win: c.win }
    return { entries, patch: firstPatch(parsed.data.trends?.win) }
  }

  async synergies(champion: number, mine: Position, ally: Position): Promise<TableEntries> {
    const text = await this.mcp.callTool('lol_get_champion_synergies', {
      champion: await this.param(champion),
      my_position: mine,
      synergy_position: ally,
      desired_output_fields: ['data.synergies[].{synergy_champion_id,play,win}']
    })
    const parsed = validate(SynergySchema, parseText(text), 'sinergias')
    const entries: Record<number, { play: number; win: number }> = {}
    for (const s of parsed.data.synergies) if (s.play > 0) entries[s.synergy_champion_id] = { play: s.play, win: s.win }
    return { entries, patch: null }
  }

  async patch(ref: { champion: number; position: Position }): Promise<string | null> {
    const text = await this.mcp.callTool('lol_get_champion_analysis', {
      game_mode: 'ranked',
      champion: await this.param(ref.champion),
      position: ref.position,
      tier: 'EMERALD_PLUS',
      desired_output_fields: ['data.trends.win']
    })
    const parsed = validate(PatchProbeSchema, parseText(text), 'patch')
    // o servidor às vezes devolve `trends.win` vazio durante a recomputação dos dados: não é um patch válido
    const v = firstPatch(parsed.data.trends.win)
    if (!v) throw new SourceFailure('opgg', 'validation', 'patch ausente na resposta')
    return v
  }

  async buildGeneral(champion: number, position: Position, tier: EloTier): Promise<GeneralBuildData> {
    const item = '{ids[],ids_names[],pick_rate,play,win}'
    const text = await this.mcp.callTool('lol_get_champion_analysis', {
      game_mode: 'ranked',
      champion: await this.param(champion),
      position,
      tier,
      desired_output_fields: [
        'data.damage_type',
        `data.core_items[].${item}`,
        `data.boots[].${item}`,
        `data.starter_items[].${item}`,
        `data.fourth_items[].${item}`,
        `data.fifth_items[].${item}`,
        `data.sixth_items[].${item}`,
        `data.summoner_spells[].${item}`,
        'data.runes[].{id,pick_rate,play,primary_page_id,primary_rune_ids[],secondary_page_id,secondary_rune_ids[],stat_mod_ids[],win}',
        'data.skills[].{order[],pick_rate,play,win}',
        'data.skill_masteries[].{ids[],pick_rate,play,win}',
        'data.trends.win'
      ]
    })
    const d = validate(GeneralBuildSchema, parseText(text), 'builds do campeão').data
    const skills: SkillPlan | null = d.skills ? { order: d.skills.order, play: d.skills.play, win: d.skills.win } : null
    return {
      damageType: d.damage_type ? (DAMAGE[d.damage_type] ?? null) : null,
      core: d.core_items ? toItemSet(d.core_items) : null,
      boots: d.boots ? toItemSet(d.boots) : null,
      starter: d.starter_items ? toItemSet(d.starter_items) : null,
      slot4: (d.fourth_items ?? []).map(toItemSet),
      slot5: (d.fifth_items ?? []).map(toItemSet),
      slot6: (d.sixth_items ?? []).map(toItemSet),
      spells: d.summoner_spells ? toItemSet(d.summoner_spells) : null,
      runes: d.runes ? toRunePage(d.runes) : null,
      skills,
      skillPriority: d.skill_masteries?.ids ?? [],
      patch: firstPatch(d.trends?.win),
      fetchedAt: 0
    }
  }

  async matchupGuide(champion: number, opponent: number, position: Position): Promise<MatchupGuideData> {
    const { nameById } = await this.roster()
    const text = await this.mcp.callTool('lol_get_lane_matchup_guide', { position, my_champion: await this.param(champion), opponent_champion: await this.param(opponent) })
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (e) {
      throw new SourceFailure('opgg', 'parse', 'guia de confronto não é JSON', { cause: e })
    }
    const d = validate(GuideBuildSchema, json, 'guia de confronto').data
    const side = (v: string | null | undefined): LaneSide | null => {
      if (!v) return null
      if (v.toUpperCase() === 'EVEN') return 'even'
      const n = normalizeName(v)
      if (n === normalizeName(nameById.get(champion) ?? '')) return 'me'
      if (n === normalizeName(nameById.get(opponent) ?? '')) return 'opponent'
      return null
    }
    const rec = d.counters.find((c) => c.champion_id === opponent)
    const style = d.recommended_play_style
    const singles: ItemSet[][] = [[], [], [], [], [], []]
    for (const s of d.single_items) if (s.depth >= 1 && s.depth <= 6) singles[s.depth - 1] = s.items.map(toItemSet)
    return {
      opponent,
      position,
      cores: d.core_items.map(toItemSet),
      boots: d.boots.map(toItemSet),
      starters: d.starter_items.map(toItemSet),
      singles,
      spells: d.summoner_spells.map(toItemSet),
      runes: d.runes.map(toRunePage),
      skills: d.skills.map((k) => ({ order: k.order, play: k.play, win: k.win })),
      tipEn: d.opponent_champion_tip ?? null,
      laneAdvantage: side(d.lane_advantage_champion),
      soloKillAdvantage: side(d.lane_solo_kill_advantage_champion),
      playStyle: style === 'aggressive' || style === 'defensive' || style === 'even' ? style : null,
      gameLengths: d.game_lengths.map((g) => ({ from: g.game_length, rate: g.rate })),
      record: rec ? { play: rec.play, win: rec.win } : null,
      patch: firstPatch(d.trends?.win),
      fetchedAt: 0
    }
  }
}
