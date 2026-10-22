import { CONFIG } from './config'
import { evaluateComposition, type TeamMember } from './composition'
import { explainTop } from './explain-rank'
import { hoveredByAllies, unavailableChampions } from './draft'
import { fmtInt, fmtPct, fmtSignedPp, ELO_LABEL } from './format'
import { inferPositions, type PositionDistribution, type PositionInput } from './positions'
import { rankStable } from './rank'
import { adequacy, clamp, sampleWeight, shrinkRate, winRate } from './stats'
import { traitsFor, type TraitsTable } from './traits'
import {
  matchupKey,
  POSITION_LABEL,
  synergyKey,
  type BaseStat,
  type Caveat,
  type ChampionInfo,
  type DataQuality,
  type Draft,
  type Factor,
  type Familiarity,
  type PlayerData,
  type Position,
  type Preferences,
  type Recommendation,
  type RecommendationResult,
  type StatsSnapshot
} from './types'

export interface EngineInput {
  draft: Draft
  /** Minha posição efetiva (atribuída pelo cliente ou escolhida). */
  position: Position | null
  stats: StatsSnapshot | null
  roster: ReadonlyMap<number, ChampionInfo>
  traits: TraitsTable
  prefs: Preferences
  player: PlayerData | null
  now: number
  /** Ordem exibida anteriormente (para histerese). */
  previousOrder?: readonly number[]
}

const nameOf = (roster: ReadonlyMap<number, ChampionInfo>, id: number): string => roster.get(id)?.name ?? `#${id}`

function positionMean(table: Record<number, BaseStat> | undefined): number {
  if (!table) return 0.5
  let w = 0
  let p = 0
  for (const s of Object.values(table)) {
    if (s.play >= CONFIG.minPlayCandidate) {
      w += s.win
      p += s.play
    }
  }
  return p > 0 ? w / p : 0.5
}

export function recommend(input: EngineInput): RecommendationResult {
  const { draft, position, stats, roster, traits, prefs, player, now } = input
  const empty = (status: RecommendationResult['status'], warnings: Caveat[] = []): RecommendationResult => ({
    status,
    items: [],
    ranking: [],
    rankExplanation: null,
    considered: 0,
    excludedCount: 0,
    warnings,
    position,
    laneOpponentDistribution: [],
    provenance: stats?.provenance ?? null
  })
  if (!position) return empty('no-position')

  /* ---------------- avisos globais de procedência ---------------- */
  const warnings: Caveat[] = []
  const prov = stats?.provenance ?? null
  if (prov) {
    if (prov.patch && prov.currentPatch && prov.patch !== prov.currentPatch) {
      warnings.push({
        kind: 'patch-mismatch',
        text: `Estatísticas do patch ${prov.patch}, mas o jogo está no ${prov.currentPatch}. Podem estar defasadas.`
      })
    }
    if (prov.fetchedAt != null && now - prov.fetchedAt > CONFIG.staleAfterMs) {
      warnings.push({ kind: 'stale', text: 'Estatísticas em cache com mais de 36 horas.' })
    }
    if (prov.tier !== prov.tableTier) {
      warnings.push({
        kind: 'mixed-tier',
        text: `Taxas básicas em ${ELO_LABEL[prov.tier] ?? prov.tier}; confrontos e sinergias vêm do agregado ${ELO_LABEL[prov.tableTier] ?? prov.tableTier} e pesam menos.`
      })
    }
  }
  const tierFactor = prov && prov.tier !== prov.tableTier ? CONFIG.mixedTierFactor : 1

  /* ---------------- posições dos times (declaradas + inferidas) ---------------- */
  const roleRates = stats?.roleRates ?? {}
  const allyInputs: PositionInput[] = draft.allies.map((s) => ({
    champion: s.isMe ? null : s.champion,
    declared: s.isMe ? position : s.position
  }))
  const allyDist = inferPositions(allyInputs, roleRates)
  const enemyInputs: PositionInput[] = draft.enemies.map((s) => ({ champion: s.champion, declared: s.position }))
  const enemyDist = inferPositions(enemyInputs, roleRates)

  /* ---------------- membros dos times ---------------- */
  const allyMembers: TeamMember[] = []
  const allyRefs: { champion: number; weight: number; dist: PositionDistribution }[] = []
  draft.allies.forEach((s, i) => {
    if (s.isMe || s.champion == null || s.state === 'empty') return
    const weight = s.state === 'locked' ? 1 : CONFIG.hoverWeight
    allyMembers.push({ champion: s.champion, weight, traits: traitsFor(traits, s.champion, roster.get(s.champion)?.tags) })
    allyRefs.push({ champion: s.champion, weight, dist: allyDist[i]! })
  })
  const enemyMembers: TeamMember[] = []
  const enemyLane: { champion: number; probability: number }[] = []
  draft.enemies.forEach((s, i) => {
    if (s.champion == null || s.state === 'empty') return
    const weight = s.state === 'locked' ? 1 : CONFIG.hoverWeight
    enemyMembers.push({ champion: s.champion, weight, traits: traitsFor(traits, s.champion, roster.get(s.champion)?.tags) })
    const q = (enemyDist[i]?.byPosition[position] ?? 0) * weight
    if (q > 0.001) enemyLane.push({ champion: s.champion, probability: q })
  })
  enemyLane.sort((a, b) => b.probability - a.probability)
  const laneMass = enemyLane.reduce((a, b) => a + b.probability, 0)
  const topLane = enemyLane[0]
  const uncertainOpponent = !!topLane && topLane.probability < 0.75

  /* ---------------- candidatos ---------------- */
  const unavailable = unavailableChampions(draft)
  const hovered = hoveredByAllies(draft)
  const baseTable = stats?.base[position]
  const baseDefTable = stats?.baseDefault[position]
  const mu = positionMean(baseTable)
  const muDef = positionMean(baseDefTable)

  const pool = prefs.pool
  const poolIds = new Set(Object.keys(pool).map(Number))
  const excluded = new Set(prefs.excluded)
  const owned = player?.owned && prefs.hideUnowned ? new Set(player.owned) : null

  const candidateIds = new Set<number>()
  if (baseTable) {
    for (const [idStr, s] of Object.entries(baseTable)) {
      if (s.play >= CONFIG.minPlayCandidate && s.roleRate >= CONFIG.minRoleRate) candidateIds.add(Number(idStr))
    }
  } else {
    // sem estatísticas: alternativa estática (rotas típicas do campeão) + pool
    for (const info of roster.values()) {
      if (traits[info.id]?.positions.includes(position)) candidateIds.add(info.id)
    }
  }
  for (const id of poolIds) if (roster.has(id) || baseTable?.[id]) candidateIds.add(id)

  let excludedCount = 0
  const candidates: number[] = []
  for (const id of candidateIds) {
    const drop =
      unavailable.has(id) ||
      excluded.has(id) ||
      (owned != null && !owned.has(id)) ||
      (prefs.restrictToPool && !poolIds.has(id)) ||
      !roster.has(id)
    if (drop) excludedCount++
    else candidates.push(id)
  }

  if (candidates.length === 0) {
    const r = empty(stats ? 'insufficient' : 'no-stats', warnings)
    r.excludedCount = excludedCount
    return r
  }

  /* ---------------- pontuação por candidato ---------------- */
  const shrunkBase = (table: Record<number, BaseStat> | undefined, id: number, prior: number): number | null => {
    const s = table?.[id]
    return s ? shrinkRate(s.win, s.play, prior, CONFIG.shrinkage.base) : null
  }

  const scored: Recommendation[] = candidates.map((id) => {
    const info = roster.get(id)!
    const factors: Factor[] = []
    const caveats: Caveat[] = []
    const base = baseTable?.[id]
    const posLabel = POSITION_LABEL[position]

    /* ----- Estatística: base ----- */
    let basePp = 0
    let pBaseSel: number | null = null
    if (base) {
      pBaseSel = shrinkRate(base.win, base.play, mu, CONFIG.shrinkage.base)
      basePp = (pBaseSel - mu) * 100
      const obs = winRate(base.win, base.play)
      const w = sampleWeight(base.play, CONFIG.shrinkage.base)
      factors.push({
        kind: 'base',
        group: 'estatistica',
        pp: basePp,
        confidence: w,
        text: `${fmtPct(obs ?? 0)} de vitórias como ${posLabel} no patch ${prov?.patch ?? '?'} (${fmtInt(base.play)} partidas, ${ELO_LABEL[prov?.tier ?? 'EMERALD_PLUS']}).`
      })
      if (base.play < CONFIG.insufficientBase) {
        caveats.push({ kind: 'low-sample', text: `Amostra muito pequena (${fmtInt(base.play)} partidas): a taxa foi puxada para a média da rota.` })
      } else if (base.play < CONFIG.lowSampleBase) {
        caveats.push({ kind: 'low-sample', text: `Amostra pequena (${fmtInt(base.play)} partidas): confiança reduzida.` })
      }
      if (base.roleRate < CONFIG.minRoleRate) {
        caveats.push({ kind: 'off-role', text: `Raramente jogado em ${posLabel} (${fmtPct(base.roleRate)} das partidas do campeão).` })
      }
    } else {
      caveats.push({ kind: 'no-stats', text: stats ? `Sem estatísticas deste campeão em ${posLabel} neste patch.` : 'Sem estatísticas disponíveis agora.' })
    }

    /* ----- Estatística: matchup de rota ----- */
    let lanePp = 0
    let laneSample: number | null = null
    const laneOpponents: Recommendation['laneOpponents'] = []
    const pXdef = shrunkBase(baseDefTable, id, muDef)
    const table = stats?.matchups[matchupKey(id, position)]
    const matchupParts: { champion: number; q: number; edge: number; play: number; obs: number; weightShare: number }[] = []
    for (const opp of enemyLane) {
      const entry = table?.entries[opp.champion]
      laneOpponents.push({
        champion: opp.champion,
        probability: opp.probability,
        play: entry?.play ?? null,
        winRate: entry ? winRate(entry.win, entry.play) : null
      })
      if (!entry || pXdef == null) continue
      const pYdef = shrunkBase(baseDefTable, opp.champion, muDef) ?? 0.5
      const prior = clamp(0.5 + pXdef - pYdef, 0.05, 0.95)
      const mShrunk = shrinkRate(entry.win, entry.play, prior, CONFIG.shrinkage.matchup)
      const edge = mShrunk - pXdef
      lanePp += opp.probability * edge * 100
      matchupParts.push({
        champion: opp.champion,
        q: opp.probability,
        edge,
        play: entry.play,
        obs: entry.win / entry.play,
        weightShare: sampleWeight(entry.play, CONFIG.shrinkage.matchup)
      })
    }
    lanePp = clamp(lanePp * tierFactor, -CONFIG.caps.lanePp, CONFIG.caps.lanePp)
    if (matchupParts.length > 0) {
      matchupParts.sort((a, b) => Math.abs(b.q * b.edge) - Math.abs(a.q * a.edge))
      const top = matchupParts[0]!
      laneSample = top.play
      const who = `${nameOf(roster, top.champion)}${top.q < 0.95 ? ` (provável oponente de rota, ${Math.round(top.q * 100)}%)` : ' (oponente de rota)'}`
      factors.push({
        kind: 'matchup',
        group: 'estatistica',
        pp: lanePp,
        confidence: top.weightShare,
        text: `Contra ${who}: ${fmtPct(top.obs)} de vitórias em ${fmtInt(top.play)} partidas.`
      })
      if (top.play < CONFIG.lowSampleMatchup) {
        caveats.push({ kind: 'low-sample', text: `Confronto com poucos jogos (${fmtInt(top.play)}): efeito reduzido.` })
      }
    } else if (laneMass >= 0.3 && stats) {
      const names = enemyLane.slice(0, 2).map((o) => nameOf(roster, o.champion)).join(' / ')
      caveats.push({ kind: 'no-matchup-data', text: `Sem dados de confronto contra ${names}.` })
    }
    if (uncertainOpponent && topLane) {
      caveats.push({
        kind: 'uncertain-opponent',
        text: `Oponente de rota incerto (${nameOf(roster, topLane.champion)}: ${Math.round(topLane.probability * 100)}%); peso do confronto reduzido.`
      })
    }

    /* ----- Estatística: sinergia com aliados ----- */
    let synergyPp = 0
    const synergyParts: { champion: number; pos: Position; lift: number; play: number; obs: number }[] = []
    let missingSynergyTable = false
    for (const ally of allyRefs) {
      const pos = ally.dist.best
      if (!pos || pos === position || ally.dist.bestProbability < CONFIG.allyPositionMinProbability) continue
      const t = stats?.synergies[synergyKey(id, position, pos)]
      if (!t) {
        if (ally.weight >= 1) missingSynergyTable = true
        continue
      }
      const entry = t.entries[ally.champion]
      if (!entry || pXdef == null) continue
      const pAdef = shrunkBase(stats?.baseDefault[pos], ally.champion, 0.5) ?? 0.5
      const expected = clamp(0.5 + (pXdef - 0.5) + (pAdef - 0.5), 0.05, 0.95)
      const obs = entry.win / entry.play
      const lift = sampleWeight(entry.play, CONFIG.shrinkage.synergy) * (obs - expected)
      synergyPp += lift * 100 * ally.weight * ally.dist.bestProbability
      synergyParts.push({ champion: ally.champion, pos, lift, play: entry.play, obs })
    }
    synergyPp = clamp(synergyPp * tierFactor, -CONFIG.caps.synergyPp, CONFIG.caps.synergyPp)
    if (synergyParts.length > 0) {
      synergyParts.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift))
      const top = synergyParts[0]!
      factors.push({
        kind: 'synergy',
        group: 'estatistica',
        pp: synergyPp,
        confidence: sampleWeight(top.play, CONFIG.shrinkage.synergy),
        text: `Em dupla com ${nameOf(roster, top.champion)} (${POSITION_LABEL[top.pos].toLowerCase()}): ${fmtPct(top.obs)} de vitórias em ${fmtInt(top.play)} partidas, ${top.lift >= 0 ? 'acima' : 'abaixo'} do esperado pelas taxas individuais.`
      })
    } else if (missingSynergyTable) {
      caveats.push({ kind: 'no-synergy-data', text: 'Sinergia com aliados ainda não carregada ou indisponível.' })
    }

    /* ----- Composição (heurística) ----- */
    const myTraits = traitsFor(traits, id, info.tags)
    const comp = evaluateComposition(allyMembers, enemyMembers, myTraits)
    factors.push(...comp.factors)
    const compPp = comp.totalPp

    /* ----- Preferências pessoais ----- */
    let personalPp = 0
    let familiarity: Recommendation['familiarity'] = { level: null, source: 'nenhuma' }
    const mult = prefs.familiarityWeight
    const explicit = pool[id]
    const mastery = player?.mastery[id]
    const inferredLevel = mastery ? levelFromMastery(mastery.points) : null
    if (explicit) {
      personalPp = CONFIG.personal.familiarityPp[explicit] * mult
      familiarity = { level: explicit, source: 'pool' }
      factors.push({
        kind: 'familiarity',
        group: 'pessoal',
        pp: personalPp,
        text: `Está na sua pool como "${LEVEL_NAME[explicit]}".`
      })
    } else if (inferredLevel) {
      personalPp = CONFIG.personal.familiarityPp[inferredLevel] * mult * CONFIG.personal.inferredWeight
      familiarity = { level: inferredLevel, source: 'maestria', points: mastery!.points }
      factors.push({
        kind: 'familiarity',
        group: 'pessoal',
        pp: personalPp,
        text: `Maestria de ${fmtInt(mastery!.points)} pontos no cliente (estimativa de familiaridade).`
      })
    } else if (poolIds.size > 0) {
      personalPp = CONFIG.personal.outsidePoolPp * mult
      factors.push({
        kind: 'familiarity',
        group: 'pessoal',
        pp: personalPp,
        text: 'Fora da sua pool: sem familiaridade registrada.'
      })
    }

    if (hovered.has(id)) {
      caveats.push({ kind: 'ally-hover', text: 'Um aliado está com este campeão selecionado (ainda não confirmado).' })
    }

    /* ----- Total, qualidade, motivos, risco ----- */
    const totalPp = basePp + lanePp + synergyPp + compPp + personalPp
    const score = adequacy(totalPp, CONFIG.adequacyScalePp)

    const quality = qualityOf(base, caveats)
    const reasons = pickReasons(factors)
    const risk = pickRisk(factors, caveats)

    return {
      championId: id,
      score,
      totalPp,
      factors,
      reasons,
      risk,
      caveats,
      quality,
      sample: { base: base?.play ?? null, lane: laneSample },
      baseWinRate: base ? winRate(base.win, base.play) : null,
      laneOpponents,
      familiarity
    }
  })

  // Sem estatísticas só vale mostrar o que tem algum sinal (composição ou preferências); do contrário a
  // lista seria arbitrária e passaria falsa impressão de recomendação.
  const informative = stats ? scored : scored.filter((r) => r.totalPp > 0.05)
  const ranked = rankStable(informative, input.previousOrder ?? [])
  const items = ranked.slice(0, CONFIG.display.maxItems)

  const status: RecommendationResult['status'] = stats ? 'ok' : 'no-stats'
  if (!stats && items.length > 0) {
    warnings.push({
      kind: 'no-stats',
      text: 'Sem estatísticas: a ordem usa apenas composição do time e suas preferências.'
    })
  }

  return {
    status,
    items,
    ranking: ranked.map((r) => r.championId),
    rankExplanation: explainTop(items, (id) => nameOf(roster, id)),
    considered: candidates.length,
    excludedCount,
    warnings,
    position,
    laneOpponentDistribution: enemyLane,
    provenance: prov
  }
}

const LEVEL_NAME: Record<Familiarity, string> = { 1: 'Aprendendo', 2: 'Confortável', 3: 'Dominado', 4: 'Especialista' }

export function levelFromMastery(points: number): Familiarity | null {
  for (const l of CONFIG.personal.masteryLevels) if (points >= l.min) return l.level
  return null
}

function qualityOf(base: BaseStat | undefined, caveats: Caveat[]): DataQuality {
  if (!base || base.play < CONFIG.insufficientBase) return 'insufficient'
  const partialKinds: Caveat['kind'][] = ['low-sample', 'no-matchup-data', 'off-role', 'no-synergy-data']
  return caveats.some((c) => partialKinds.includes(c.kind)) ? 'partial' : 'ok'
}

/** 2–3 motivos concretos: fatores positivos mais fortes; completa com neutros se faltar. */
function pickReasons(factors: Factor[]): Factor[] {
  const sorted = [...factors].sort((a, b) => b.pp - a.pp)
  const strong = sorted.filter((f) => f.pp >= 0.25).slice(0, 3)
  if (strong.length >= 2) return strong
  const rest = sorted.filter((f) => !strong.includes(f) && f.pp > -0.25)
  return [...strong, ...rest].slice(0, 2)
}

const CAVEAT_PRIORITY: Caveat['kind'][] = [
  'no-stats',
  'no-matchup-data',
  'uncertain-opponent',
  'low-sample',
  'off-role',
  'ally-hover',
  'no-synergy-data'
]

function pickRisk(factors: Factor[], caveats: Caveat[]): Recommendation['risk'] {
  const worst = [...factors].sort((a, b) => a.pp - b.pp)[0]
  if (worst && worst.pp <= -0.35) {
    return { text: `${worst.text} (${fmtSignedPp(worst.pp)} p.p.)`, kind: worst.kind }
  }
  for (const k of CAVEAT_PRIORITY) {
    const c = caveats.find((x) => x.kind === k)
    if (c) return { text: c.text, kind: c.kind }
  }
  return null
}
