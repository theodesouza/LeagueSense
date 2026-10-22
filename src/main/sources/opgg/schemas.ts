import { z } from 'zod'

const num = z.number().finite()

export const ChampionListSchema = z.object({
  data: z.object({ champions: z.array(z.object({ champion_id: z.number().int(), key: z.string().min(1), name: z.string().min(1) })) })
})

const LaneRow = z.object({
  champion: z.string().min(1),
  play: num.nonnegative(),
  win: num.nonnegative(),
  pick_rate: num,
  role_rate: num,
  ban_rate: num
})
export const LaneMetaSchema = z.object({
  data: z.object({
    positions: z.object({
      top: z.array(LaneRow),
      mid: z.array(LaneRow),
      jungle: z.array(LaneRow),
      adc: z.array(LaneRow),
      support: z.array(LaneRow)
    })
  })
})

const TrendWin = z.object({ version: z.string() })
export const AnalysisBaseSchema = z.object({
  data: z.object({
    summary: z.object({
      positions: z.array(
        z.object({
          name: z.string(),
          stats: z.object({ play: num.nonnegative(), win_rate: num.min(0).max(1), role_rate: num, pick_rate: num, ban_rate: num })
        })
      )
    }),
    trends: z.object({ win: z.union([TrendWin, z.array(TrendWin)]) }).optional()
  })
})

export const MatchupGuideSchema = z.object({
  data: z.object({
    counters: z.array(z.object({ champion_id: z.number().int(), play: num.nonnegative(), win: num.nonnegative() })),
    trends: z.object({ win: z.array(TrendWin) }).optional()
  })
})

export const SynergySchema = z.object({
  data: z.object({
    synergies: z.array(z.object({ synergy_champion_id: z.number().int(), play: num.nonnegative(), win: num.nonnegative() }))
  })
})

export const PatchProbeSchema = z.object({
  data: z.object({ trends: z.object({ win: z.union([TrendWin, z.array(TrendWin)]) }) })
})

/* ---------------------------- builds ---------------------------- */

const ItemSetRaw = z.object({
  ids: z.array(z.number().int()),
  ids_names: z.array(z.union([z.string(), z.number()])).optional(),
  play: num.nonnegative(),
  win: num.nonnegative(),
  pick_rate: num.optional()
})
const one = <T extends z.ZodTypeAny>(schema: T) => z.union([schema, z.array(schema).transform((a) => a[0])]).optional()
const RunesRaw = z.object({
  primary_page_id: z.number().int(),
  primary_rune_ids: z.array(z.number().int()),
  secondary_page_id: z.number().int(),
  secondary_rune_ids: z.array(z.number().int()),
  stat_mod_ids: z.array(z.number().int()),
  play: num.nonnegative(),
  win: num.nonnegative()
})
const SkillsRaw = z.object({ order: z.array(z.string()), play: num.nonnegative(), win: num.nonnegative() })

export const GeneralBuildSchema = z.object({
  data: z.object({
    damage_type: z.string().optional(),
    core_items: one(ItemSetRaw),
    boots: one(ItemSetRaw),
    starter_items: one(ItemSetRaw),
    fourth_items: z.array(ItemSetRaw).optional(),
    fifth_items: z.array(ItemSetRaw).optional(),
    sixth_items: z.array(ItemSetRaw).optional(),
    summoner_spells: one(ItemSetRaw),
    runes: one(RunesRaw),
    skills: one(SkillsRaw),
    skill_masteries: one(z.object({ ids: z.array(z.string()) })),
    trends: z.object({ win: z.union([TrendWin, z.array(TrendWin)]) }).optional()
  })
})

export const GuideBuildSchema = z.object({
  data: z.object({
    counters: z.array(z.object({ champion_id: z.number().int(), play: num.nonnegative(), win: num.nonnegative() })).default([]),
    core_items: z.array(ItemSetRaw).default([]),
    boots: z.array(ItemSetRaw).default([]),
    starter_items: z.array(ItemSetRaw).default([]),
    single_items: z.array(z.object({ depth: z.number().int(), items: z.array(ItemSetRaw) })).default([]),
    summoner_spells: z.array(ItemSetRaw).default([]),
    runes: z.array(RunesRaw).default([]),
    skills: z.array(SkillsRaw).default([]),
    opponent_champion_tip: z.string().nullish(),
    lane_advantage_champion: z.string().nullish(),
    lane_solo_kill_advantage_champion: z.string().nullish(),
    recommended_play_style: z.string().nullish(),
    game_lengths: z.array(z.object({ game_length: num, rate: num })).default([]),
    trends: z.object({ win: z.array(TrendWin) }).optional()
  })
})
export type ItemSetRawT = z.infer<typeof ItemSetRaw>
export type RunesRawT = z.infer<typeof RunesRaw>
