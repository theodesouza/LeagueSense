import { SourceFailure } from '../../errors'
import type { BaseStat, EloTier, Position, PositionRecord } from '@core/types'
import { POSITIONS } from '@core/types'
import type { StatsProvider, LaneMeta, TableEntries } from '../provider'
import { parseDsl } from './dsl'
import type { McpLike } from './mcp'
import { AnalysisBaseSchema, ChampionListSchema, LaneMetaSchema, MatchupGuideSchema, PatchProbeSchema, SynergySchema } from './schemas'
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
}

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
        for (const c of parsed.data.champions) {
          // ignora variantes de modos especiais (ex.: "Jade_Annie", ids ≥ 60000)
          if (c.champion_id >= 60000 || c.key.includes('_')) continue
          byName.set(normalizeName(c.name), c.champion_id)
          keyById.set(c.champion_id, c.key)
        }
        return { byName, keyById }
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
}
