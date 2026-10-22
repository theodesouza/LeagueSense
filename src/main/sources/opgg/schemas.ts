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
