import type { TeamMember } from './composition'
import { fmtInt, fmtPct, fmtPct0 } from './format'
import { matchupAdvice } from './matchup-advice'
import { profileTeam, type TeamProfile } from './teams'
import type { ChampionTraits } from './traits'
import type {
  BehaviorGroup,
  BuildBundle,
  BuildId,
  GamePlan,
  GeneralBuildData,
  ItemInfo,
  ItemSet,
  MatchupAdvice,
  MatchupGuideData,
  PlannedBuild,
  PlannedItem,
  RunePage,
  SkillPlan
} from './build-types'
import { POSITION_LABEL, type Position } from './types'

/**
 * Planejador de builds e plano de jogo. Determinístico e explicável:
 *  - OS ITENS vêm de dados reais de meta (OP.GG): só se escolhe entre o que jogadores realmente compraram;
 *  - A ADAPTAÇÃO aos dois times usa regras simples sobre as etiquetas dos itens (Data Dragon) e os traços
 *    dos campeões — cada ajuste cita o fato que o motivou;
 *  - O OBJETIVO e o COMPORTAMENTO são regras (heurísticas), não estatística de vitória.
 */

/* --------------------------- parâmetros (justificados) --------------------------- */

/** Prior de itens: amostras por item são pequenas; k=60 puxa taxas para 50 % com folga. */
const K_ITEM = 60
/** Peso (p.p.) de uma necessidade totalmente atendida por um item. Heurístico, não calibrado. */
const FIT_PP = 3
/** Bônus (p.p.) pela taxa de escolha — mantém a build dentro do que é popular. */
const PICK_PP = 3
/** Menor amostra (partidas) para um item entrar como candidato. */
const MIN_PLAY = 8
/** Menor amostra para considerar uma build/feitiço/runa "mais vencedora". */
const MIN_PLAY_BEST = 20
const LAMBDA = { meta: 1, confronto: 0.6, adaptada: 1.5 } as const

const shrunk = (win: number, play: number, k = K_ITEM): number => (win + (k * 0.5)) / (play + k)
const edge = (win: number, play: number): number => (shrunk(win, play) - 0.5) * 100
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const sample = (s: { play: number; win: number }): string => `${fmtInt(s.play)} partidas · ${fmtPct(s.win / Math.max(1, s.play))} de vitórias`

/* --------------------------- necessidades dos times --------------------------- */

type NeedKind = 'armadura' | 'resistencia' | 'penetracao' | 'tenacidade' | 'defesa' | 'anticura'
interface Need {
  kind: NeedKind
  value: number
  why: string
}

const names = (ids: number[], nameOf: (id: number) => string, max = 3): string => ids.slice(0, max).map(nameOf).join(', ')

export function computeNeeds(me: ChampionTraits, enemy: TeamProfile, ally: TeamProfile, nameOf: (id: number) => string): Need[] {
  const out: Need[] = []
  if (enemy.physical != null) {
    const armor = clamp01((enemy.physical - 0.5) / 0.3)
    const mr = clamp01((1 - enemy.physical - 0.5) / 0.3)
    if (armor > 0.05) out.push({ kind: 'armadura', value: armor, why: `${fmtPct0(enemy.physical)} do dano inimigo é físico (${names(enemy.top.physical, nameOf)})` })
    if (mr > 0.05) out.push({ kind: 'resistencia', value: mr, why: `${fmtPct0(1 - enemy.physical)} do dano inimigo é mágico (${names(enemy.top.magic, nameOf)})` })
  }
  const pen = clamp01((enemy.frontline - 1.5) / 1.5)
  if (pen > 0.05) out.push({ kind: 'penetracao', value: pen, why: `inimigos com muita resistência (${names(enemy.top.tanks, nameOf)})` })
  const ten = clamp01((enemy.cc - 2.5) / 2)
  if (ten > 0.05) out.push({ kind: 'tenacidade', value: ten, why: `muito controle de grupo inimigo (${names(enemy.top.cc, nameOf)})` })
  let def = me.frontline < 0.5 ? clamp01((enemy.dive - 1.2) / 1.5) : 0
  if (me.hypercarry && ally.peel < 0.5 && ally.weight >= 3) def = clamp01(def + 0.3)
  if (def > 0.05) {
    const why = enemy.dive >= 1.2 ? `inimigos com mergulho (${names(enemy.top.dive, nameOf)})` : 'seu time tem pouca proteção para quem causa dano'
    out.push({ kind: 'defesa', value: def, why })
  }
  const heal = clamp01(enemy.sustain / 1.5)
  if (enemy.sustain >= 0.8) out.push({ kind: 'anticura', value: heal, why: `inimigos que se curam (${names(enemy.top.sustain, nameOf)})` })
  return out
}

/** Quanto um item atende às necessidades (0+), com os motivos que valeram. */
export function itemFit(item: ItemInfo | undefined, needs: Need[], me: ChampionTraits): { fit: number; why: string[] } {
  if (!item) return { fit: 0, why: [] }
  const t = new Set(item.tags)
  let fit = 0
  const why: string[] = []
  const add = (n: Need, v: number, label: string): void => {
    fit += n.value * v
    why.push(`${label}: ${n.why}`)
  }
  for (const n of needs) {
    if (n.kind === 'armadura' && t.has('Armor')) add(n, 1, 'Armadura')
    else if (n.kind === 'resistencia' && (t.has('SpellBlock') || t.has('MagicResist'))) add(n, 1, 'Resistência mágica')
    else if (n.kind === 'penetracao' && t.has(me.ad >= 0.5 ? 'ArmorPenetration' : 'MagicPenetration')) add(n, 1, 'Penetração')
    else if (n.kind === 'tenacidade' && t.has('Tenacity')) add(n, 1.2, 'Tenacidade')
    else if (n.kind === 'anticura' && item.antiHeal) add(n, 1.2, 'Redução de cura')
    else if (n.kind === 'defesa' && (t.has('Health') || t.has('Armor') || t.has('SpellBlock'))) add(n, t.has('Active') ? 1 : 0.6, 'Sobrevivência')
  }
  return { fit, why }
}

/* --------------------------- candidatos --------------------------- */

interface Cand {
  ids: number[]
  names: string[]
  play: number
  win: number
  pick: number
  from: 'geral' | 'confronto'
}
const toCand = (s: ItemSet, from: Cand['from']): Cand => ({ ids: s.ids, names: s.names, play: s.play, win: s.win, pick: s.pick, from })

function util(c: Cand, fit: number, lambda: number): number {
  return edge(c.win, c.play) + PICK_PP * c.pick + lambda * FIT_PP * fit
}

/* --------------------------- arquétipos e textos --------------------------- */

export type Archetype = 'mago' | 'atirador' | 'assassino' | 'lutador' | 'tanque' | 'suporte' | 'generico'
export const ARCHETYPE_LABEL: Record<Archetype, string> = { mago: 'Mago', atirador: 'Atirador', assassino: 'Assassino', lutador: 'Lutador', tanque: 'Tanque', suporte: 'Suporte/Protetor', generico: 'Versátil' }

export function archetypeOf(t: ChampionTraits): Archetype {
  if (t.hypercarry && t.ranged && t.damageWeight >= 0.9) return 'atirador'
  if (t.dive >= 0.8 && t.damageWeight >= 0.65) return 'assassino'
  if (t.frontline >= 0.8 && t.damageWeight <= 0.65) return 'tanque'
  if (t.peel >= 0.7 && t.damageWeight <= 0.65) return 'suporte'
  if (t.ap >= 0.7 && t.ranged) return 'mago'
  if (!t.ranged && t.damageWeight >= 0.65) return 'lutador'
  return 'generico'
}

const OBJECTIVE: Record<Archetype, string> = {
  mago: 'Dominar a rota, escalar e causar dano de longe nas lutas, eliminando os alvos prioritários sem se expor.',
  atirador: 'Sobreviver à rota, chegar aos itens principais e causar dano contínuo nas lutas de equipe, sempre protegido por aliados.',
  assassino: 'Pegar alvos isolados e eliminar o carregador ou mago inimigo, usando mobilidade para entrar e sair das lutas.',
  lutador: 'Ganhar vantagem de rota e converter em pressão nos objetivos; lutar na frente quando o time precisar ou dividir a pressão quando estiver à frente.',
  tanque: 'Abrir as lutas, absorver dano e controlar os inimigos-chave para o seu time causar dano com segurança.',
  suporte: 'Proteger e habilitar quem causa dano, controlar a visão e iniciar ou desfazer lutas nos momentos certos.',
  generico: 'Ganhar a rota, converter vantagem em objetivos e se posicionar para participar das lutas importantes.'
}

const DEFAULT_BEHAVIOR: Record<Archetype, [string[], string[], string[]]> = {
  mago: [
    ['Farme com segurança até o primeiro item completo e use habilidades de rota só quando o oponente gastar a mobilidade.', 'Empurre a onda antes de recuar ou rotacionar: tropas na torre dele são vantagem de tempo para você.'],
    ['Use a vantagem de itens para empurrar e rotacionar para objetivos próximos; ward o rio antes de se mover.'],
    ['Lute atrás da linha de frente e use as habilidades no alvo seguro mais próximo; guarde o escape para quem mergulhar em você.']
  ],
  atirador: [
    ['Priorize farm e posicionamento; só troque dano quando seu suporte tiver as habilidades prontas.', 'Não dê abates: o segundo item completo é seu objetivo de rota.'],
    ['Acompanhe o time para dragões e torres; evite rotas laterais sozinho.'],
    ['Ataque o alvo mais próximo e seguro (não o ideal) e mantenha distância máxima; seu dano contínuo vence lutas longas se você sobreviver.']
  ],
  assassino: [
    ['Jogue pelo nível 6: farme, evite trocas caras e guarde a mobilidade para sair de situações ruins.'],
    ['Procure alvos sem visão ou isolados nas laterais e converta abates em objetivos com o time.'],
    ['Entre depois que o controle de grupo inimigo for gasto; elimine o alvo de maior prioridade e saia, em vez de ficar na luta.']
  ],
  lutador: [
    ['Controle a onda e crie vantagem de nível; escolha trocas quando o inimigo gastar as habilidades.'],
    ['Decida entre dividir a pressão (se estiver à frente) ou agrupar com o time para objetivos.'],
    ['Entre quando os alvos importantes estiverem ocupados; fique com os inimigos que poderiam escapar de você.']
  ],
  tanque: [
    ['Use a resistência para ganhar espaço, proteja seu carregador e ward antes de iniciar.'],
    ['Lidere o time para objetivos e visão; seu trabalho é fazer a luta começar nos seus termos.'],
    ['Inicie controlando o alvo de maior dano inimigo e fique perto do seu carregador.']
  ],
  suporte: [
    ['Garanta visão e arbustos; use proteção/engajamento quando o carregador for pressionado.'],
    ['Acompanhe o carregador e ward/limpe objetivos antes de eventos importantes.'],
    ['Proteja quem causa dano e interrompa quem mergulha: use as habilidades na maior ameaça ao seu carregador.']
  ],
  generico: [['Ganhe a rota com segurança e leia o que o oponente faz antes de arriscar trocas.'], ['Converta vantagem de rota em objetivos e visão.'], ['Posicione-se para participar das lutas sem ser o primeiro alvo.']]
}

/* --------------------------- montagem --------------------------- */

interface Ctx {
  champion: number
  position: Position
  me: ChampionTraits
  nameOf: (id: number) => string
  enemy: TeamProfile
  ally: TeamProfile
  needs: Need[]
  catalog: BuildBundle['catalog']
  general: GeneralBuildData | null
  guide: MatchupGuideData | null
  matchup: MatchupAdvice | null
  opponentName: string | null
}

const itemInfo = (ctx: Ctx, id: number): ItemInfo | undefined => ctx.catalog?.items[id]

function plannedItem(ctx: Ctx, id: number, fallbackName: string | undefined, role: PlannedItem['role'], why: string[], c?: { play: number; win: number }): PlannedItem {
  const info = itemInfo(ctx, id)
  return { id, name: info?.name ?? fallbackName ?? `Item ${id}`, plain: info?.plain ?? '', role, why, ...(c ? { play: c.play, win: c.win } : {}) }
}

const isBoots = (ctx: Ctx, id: number): boolean => itemInfo(ctx, id)?.tags.includes('Boots') ?? false
const isStarterLike = (ctx: Ctx, id: number): boolean => {
  const i = itemInfo(ctx, id)
  return !!i && (i.gold < 1000 || i.tags.includes('Consumable') || i.tags.includes('Trinket'))
}

function fitOf(ctx: Ctx, c: Cand): { fit: number; why: string[] } {
  // média simples quando a opção tem vários itens (ex.: um conjunto principal de 3)
  const parts = c.ids.map((id) => itemFit(itemInfo(ctx, id), ctx.needs, ctx.me))
  return { fit: parts.reduce((a, p) => a + p.fit, 0) / Math.max(1, parts.length), why: [...new Set(parts.flatMap((p) => p.why))] }
}

function slotPool(ctx: Ctx, sources: ('geral' | 'confronto')[], exclude: Set<number>): Cand[] {
  const map = new Map<number, Cand>()
  const push = (s: ItemSet, from: Cand['from']): void => {
    if (s.ids.length !== 1) return
    const id = s.ids[0]!
    if (exclude.has(id) || isBoots(ctx, id) || isStarterLike(ctx, id) || s.play < MIN_PLAY) return
    const cur = map.get(id)
    if (!cur || s.play > cur.play) map.set(id, toCand(s, from))
  }
  if (sources.includes('geral') && ctx.general) for (const s of [...ctx.general.slot4, ...ctx.general.slot5, ...ctx.general.slot6]) push(s, 'geral')
  if (sources.includes('confronto') && ctx.guide) for (const s of [...(ctx.guide.singles[3] ?? []), ...(ctx.guide.singles[4] ?? []), ...(ctx.guide.singles[5] ?? [])]) push(s, 'confronto')
  return [...map.values()]
}

function pickBest(ctx: Ctx, pool: Cand[], lambda: number, n: number): { cand: Cand; why: string[]; fit: number }[] {
  return pool
    .map((c) => {
      const f = fitOf(ctx, c)
      return { cand: c, why: f.why, fit: f.fit, u: util(c, f.fit, lambda) }
    })
    .sort((a, b) => b.u - a.u || b.cand.play - a.cand.play)
    .slice(0, n)
}

function chooseBoots(ctx: Ctx, sources: ('geral' | 'confronto')[], lambda: number): { cand: Cand; why: string[]; fit: number } | null {
  const pool: Cand[] = []
  const seen = new Set<number>()
  const add = (s: ItemSet | null | undefined, from: Cand['from']): void => {
    if (!s || s.ids.length !== 1 || seen.has(s.ids[0]!) || s.play < MIN_PLAY) return
    seen.add(s.ids[0]!)
    pool.push(toCand(s, from))
  }
  if (sources.includes('confronto')) for (const s of ctx.guide?.boots ?? []) add(s, 'confronto')
  if (sources.includes('geral')) add(ctx.general?.boots, 'geral')
  return pickBest(ctx, pool, lambda, 1)[0] ?? null
}

const sameSet = (a: number[], b: number[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join()

function bestBy<T extends { play: number; win: number }>(xs: T[], min = MIN_PLAY_BEST): T | null {
  const ok = xs.filter((x) => x.play >= min)
  return [...ok].sort((a, b) => shrunk(b.win, b.play) - shrunk(a.win, a.play) || b.play - a.play)[0] ?? null
}

function runesOf(general: GeneralBuildData | null, guide: MatchupGuideData | null, prefer: 'geral' | 'confronto'): { page: RunePage; sample: string } | null {
  const g = general?.runes ?? null
  const m = bestBy(guide?.runes ?? [])
  const page = prefer === 'confronto' ? (m ?? g) : (g ?? m)
  if (!page) return null
  return { page, sample: `${sample(page)}${page === m && prefer === 'confronto' ? ' (neste confronto)' : ''}` }
}

function skillsOf(general: GeneralBuildData | null, guide: MatchupGuideData | null, prefer: 'geral' | 'confronto'): { order: string[]; priority: string[]; sample: string } | null {
  const g: SkillPlan | null = general?.skills ?? null
  const m = bestBy(guide?.skills ?? [])
  const s = prefer === 'confronto' ? (m ?? g) : (g ?? m)
  if (!s) return null
  return { order: s.order, priority: priorityOf(s.order, general?.skillPriority), sample: sample(s) }
}

/** Prioridade de maximização (Q/W/E) a partir da ordem de pontos: quem chega a 5 pontos primeiro. */
function priorityOf(order: string[], fallback: string[] | undefined): string[] {
  const count: Record<string, number> = { Q: 0, W: 0, E: 0 }
  const done: string[] = []
  for (const k of order) {
    if (k === 'R' || !(k in count)) continue
    count[k]! += 1
    if (count[k] === 5 && !done.includes(k)) done.push(k)
  }
  for (const k of ['Q', 'W', 'E'])
    if (!done.includes(k)) done.push(k)
  return order.length >= 9 ? done : (fallback ?? done)
}

/** Feitiços: regras simples sobre o que existe nos dados (Purificar contra CC, Exaustão/Barreira contra mergulho). */
function spellsOf(ctx: Ctx, kind: BuildId): { ids: number[]; names: string[]; sample: string; note?: string } | null {
  const opts: ItemSet[] = [...(kind === 'confronto' ? ctx.guide?.spells ?? [] : []), ...(ctx.general?.spells ? [ctx.general.spells] : []), ...(kind !== 'confronto' ? ctx.guide?.spells ?? [] : [])].filter((s) => s.play >= MIN_PLAY)
  if (opts.length === 0) return null
  let pick: ItemSet | undefined
  let note: string | undefined
  if (kind === 'adaptada') {
    const cc = ctx.needs.find((n) => n.kind === 'tenacidade' && n.value >= 0.5)
    const dive = ctx.needs.find((n) => n.kind === 'defesa' && n.value >= 0.5)
    const withId = (id: number): ItemSet | undefined => opts.find((o) => o.ids.includes(id) && o.play >= 15)
    if (cc && withId(1)) {
      pick = withId(1)
      note = `Purificar: ${cc.why}`
    } else if (dive && (withId(3) || withId(21))) {
      pick = withId(3) ?? withId(21)
      note = `${pick!.ids.includes(3) ? 'Exaustão' : 'Barreira'}: ${dive.why}`
    }
  }
  if (!pick) pick = kind === 'confronto' ? (bestBy(ctx.guide?.spells ?? [], 15) ?? opts[0]) : opts[0]
  const s = pick!
  return { ids: s.ids, names: s.names, sample: sample(s), ...(note ? { note } : {}) }
}

function adaptationsOf(items: { why: string[] }[]): string[] {
  return [...new Set(items.flatMap((i) => i.why))]
}

interface Assembled {
  items: PlannedItem[]
  core: number[]
}

function assemble(ctx: Ctx, args: { starter: ItemSet | null; boots: ReturnType<typeof chooseBoots>; core: Cand; slots: ReturnType<typeof pickBest> }): Assembled {
  const items: PlannedItem[] = []
  if (args.starter) args.starter.ids.forEach((id, i) => items.push(plannedItem(ctx, id, args.starter!.names[i], 'inicial', [])))
  if (args.boots) items.push(plannedItem(ctx, args.boots.cand.ids[0]!, args.boots.cand.names[0], 'botas', args.boots.why, args.boots.cand))
  args.core.ids.forEach((id, i) => items.push(plannedItem(ctx, id, args.core.names[i], 'principal', [], args.core)))
  for (const s of args.slots) items.push(plannedItem(ctx, s.cand.ids[0]!, s.cand.names[0], 'situacional', [...s.why], s.cand))
  return { items, core: args.core.ids }
}

/* --------------------------- plano de jogo (objetivo e comportamento) --------------------------- */

function playbook(ctx: Ctx, id: BuildId, arch: Archetype): { objective: string; behavior: BehaviorGroup[] } {
  const { enemy, ally, me, nameOf } = ctx
  const squishy = me.frontline < 0.5
  const clauses: string[] = []
  const mid: { text: string; because?: string }[] = []
  const lane: { text: string; because?: string }[] = []
  const fight: { text: string; because?: string }[] = []

  const E = (ids: number[]): string => names(ids, nameOf)

  // rota: confronto
  const mu = ctx.matchup
  if (mu && ctx.opponentName) {
    const rec = mu.record ? `${fmtPct0(mu.record.winRate)} em ${fmtInt(mu.record.play)} partidas` : undefined
    if (mu.verdict === 'desfavoravel') lane.push({ text: `Confronto difícil contra ${ctx.opponentName}: priorize farm seguro, evite trocas e peça ajuda do selva.`, ...(rec ? { because: `taxa de vitória ${rec}` } : {}) })
    else if (mu.verdict === 'favoravel') lane.push({ text: `Confronto favorável contra ${ctx.opponentName}: pressione, empurre a onda e force-o a gastar recursos para abrir o mapa para o selva.`, ...(rec ? { because: `taxa de vitória ${rec}` } : {}) })
    else if (mu.verdict === 'equilibrado') lane.push({ text: `Confronto equilibrado contra ${ctx.opponentName}: ganhe pelo posicionamento e pelo tempo de recuo; evite trocas arriscadas sem vantagem.`, ...(rec ? { because: `taxa de vitória ${rec}` } : {}) })
    const style = ctx.guide?.playStyle
    if (style === 'defensive') lane.push({ text: 'Jogue defensivo na rota e escale: não force o nível 1–3.', because: 'recomendação do OP.GG para este confronto' })
    if (style === 'aggressive') lane.push({ text: 'Jogue agressivo na rota: o confronto permite pressionar cedo.', because: 'recomendação do OP.GG para este confronto' })
  }

  // objetivo: cláusulas adaptativas (no máximo 2, as mais fortes)
  const scored: { v: number; text: string }[] = []
  if (squishy && enemy.dive >= 1.2) scored.push({ v: enemy.dive, text: `Sobreviver aos mergulhos inimigos (${E(enemy.top.dive)}) é parte do objetivo: fique perto de aliados e guarde o escape.` })
  if (enemy.frontline >= 1.5 && arch !== 'tanque') scored.push({ v: enemy.frontline - 0.5, text: `Os inimigos têm muita resistência (${E(enemy.top.tanks)}): mire nos alvos de trás e conte com penetração e dano sustentado.` })
  if (ally.weight >= 3 && ally.frontline < 0.7 && arch !== 'tanque') scored.push({ v: 1.4, text: 'Seu time tem pouca linha de frente: lute atrás de aliados resistentes e prefira lutas curtas perto de objetivos.' })
  if (ally.engage >= 1 && arch !== 'tanque') scored.push({ v: 1.2, text: `Seu time tem engajamento (${E(ally.top.engage)}): entre logo depois dele.` })
  if (arch === 'tanque' && ally.hypercarries >= 1) scored.push({ v: 1.5, text: `Seu time tem carregador(es) (${E(ally.top.hypercarry)}): garanta que escalem e sobrevivam.` })
  if (me.hypercarry && ally.weight >= 3 && ally.peel < 0.5) scored.push({ v: 1.1, text: 'Seu time tem pouca proteção: posicione-se com mais cautela que o normal.' })
  scored.sort((a, b) => b.v - a.v)
  clauses.push(...scored.slice(0, 2).map((s) => s.text))

  let objective = [OBJECTIVE[arch], ...clauses].join(' ')
  if (id === 'confronto' && ctx.opponentName) objective += ` Esta build é a mais bem-sucedida contra ${ctx.opponentName}: foque em vencer a rota primeiro.`
  if (id === 'adaptada') objective += ' Esta build foi ajustada à composição dos dois times (veja o que mudou abaixo).'

  // lutas de equipe: regras adaptativas
  if (squishy && enemy.dive >= 1.2) fight.push({ text: 'Fique perto dos aliados e guarde o escape para o mergulho inimigo; não seja o primeiro a entrar.', because: `${fmtInt(Math.round(enemy.dive))}+ inimigos com mergulho (${E(enemy.top.dive)})` })
  if (enemy.frontline >= 1.5) fight.push({ text: 'Ignore a linha de frente quando puder e foque em quem está atrás; confie na penetração dos itens.', because: `resistência inimiga alta (${E(enemy.top.tanks)})` })
  if (ally.engage >= 1 && arch !== 'tanque') fight.push({ text: `Siga o engajamento de ${E(ally.top.engage)}: entre depois que o inimigo gastar controle de grupo.`, because: 'seu time tem engajamento' })
  if (ally.weight >= 3 && ally.frontline < 0.7 && arch !== 'tanque') fight.push({ text: 'Lute atrás dos aliados mais resistentes, não à frente deles.', because: 'seu time tem pouca linha de frente' })
  if ((arch === 'tanque' || arch === 'suporte') && ally.hypercarries >= 1) fight.push({ text: `Proteja ${E(ally.top.hypercarry)}: é quem escala o dano do time.`, because: 'seu time tem carregador de fim de jogo' })
  if (enemy.sustain >= 0.8) fight.push({ text: `Os inimigos que se curam (${E(enemy.top.sustain)}) alongam as lutas: elimine-os primeiro e use a redução de cura da build.`, because: 'inimigos com cura' })
  if (enemy.cc >= 2.5) fight.push({ text: 'Respeite o controle de grupo inimigo: espere ele ser gasto antes de entrar e evite ficar em linha reta.', because: `muito controle inimigo (${E(enemy.top.cc)})` })

  // meio de jogo
  const defaults = DEFAULT_BEHAVIOR[arch]
  const lens = ctx.matchup && ctx.guide?.gameLengths.length ? [...ctx.guide.gameLengths].sort((a, b) => b.rate - a.rate)[0] : undefined
  if (lens && lens.from >= 30) mid.push({ text: 'Neste confronto você rende mais em partidas longas: evite lutas arriscadas antes dos itens principais e escale.', because: 'vitórias por duração (OP.GG, indicativo)' })
  else if (lens && lens.from === 0) mid.push({ text: 'Neste confronto você rende mais cedo: converta vantagem de rota em objetivos antes dos 25 minutos.', because: 'vitórias por duração (OP.GG, indicativo)' })
  if (id === 'adaptada' && enemy.physical != null) mid.push({ text: `Seus itens defensivos foram escolhidos para o dano inimigo (${fmtPct0(enemy.physical)} físico): use isso para sobreviver a lutas em que o time inimigo foca em você.`, because: 'composição inimiga' })

  const group = (phase: string, base: string[], extra: { text: string; because?: string }[]): BehaviorGroup => ({ phase, items: [...base.map((text) => ({ text })), ...extra] })
  return {
    objective,
    behavior: [group('Fase de rota', defaults[0], lane), group('Meio de jogo', defaults[1], mid), group('Lutas de equipe', defaults[2], fight)]
  }
}

/* --------------------------- API --------------------------- */

export interface PlanInput {
  champion: number
  position: Position
  nameOf: (id: number) => string
  traitsOf: (id: number) => ChampionTraits
  allies: TeamMember[]
  enemies: TeamMember[]
  bundle: BuildBundle
  opponent: { champion: number; probability: number } | null
  /** Partidas/vitórias do campeão contra o oponente (se já conhecidas fora do guia). */
  record?: { play: number; win: number } | null
}

export function planGame(input: PlanInput): GamePlan {
  const { champion, position, bundle } = input
  const me = input.traitsOf(champion)
  const enemy = profileTeam(input.enemies)
  const ally = profileTeam(input.allies)
  const needs = computeNeeds(me, enemy, ally, input.nameOf)
  const warnings: string[] = []
  if (!bundle.catalog) warnings.push('Catálogo de itens indisponível: nomes em inglês e sem adaptação por tipo de item.')
  if (input.enemies.length === 0) warnings.push('Nenhum inimigo definido ainda: a adaptação ao time inimigo e a dica de confronto aparecem quando houver escolhas.')

  const opp = input.opponent
  const matchup = opp
    ? matchupAdvice({
        me: champion,
        opponent: opp.champion,
        probability: opp.probability,
        nameOf: input.nameOf,
        meTraits: me,
        oppTraits: input.traitsOf(opp.champion),
        record: bundle.guide?.record ?? input.record ?? null,
        guide: bundle.guide,
        riotTips: bundle.opponentTips
      })
    : null

  const ctx: Ctx = {
    champion,
    position,
    me,
    nameOf: input.nameOf,
    enemy,
    ally,
    needs,
    catalog: bundle.catalog,
    general: bundle.general,
    guide: bundle.guide,
    matchup,
    opponentName: opp ? input.nameOf(opp.champion) : null
  }
  const arch = archetypeOf(me)
  const g = bundle.general
  const m = bundle.guide
  const builds: PlannedBuild[] = []
  const mk = (id: BuildId, title: string, subtitle: string, a: Assembled, extra: Omit<PlannedBuild, 'id' | 'title' | 'subtitle' | 'archetype' | 'items' | 'objective' | 'behavior'>): void => {
    const pb = playbook(ctx, id, arch)
    builds.push({ id, title, subtitle, archetype: ARCHETYPE_LABEL[arch], items: a.items, objective: pb.objective, behavior: pb.behavior, ...extra })
  }
  const caveatsFor = (c: { play: number }, scope: string): string[] => {
    const out: string[] = []
    if (c.play < 100) out.push(`Amostra pequena (${fmtInt(c.play)} partidas) ${scope}: use como referência, não como regra.`)
    if (!bundle.catalog) out.push('Nomes de itens em inglês (catálogo indisponível).')
    return out
  }

  /* ---- 1) Meta geral ---- */
  const core1 = g?.core ? toCand(g.core, 'geral') : m?.cores[0] ? toCand(m.cores[0], 'confronto') : null
  if (core1) {
    const boots = chooseBoots(ctx, ['geral', 'confronto'], LAMBDA.meta)
    const slots = pickBest(ctx, slotPool(ctx, ['geral', 'confronto'], new Set(core1.ids)), LAMBDA.meta, 3)
    const a = assemble(ctx, { starter: g?.starter ?? m?.starters[0] ?? null, boots, core: core1, slots })
    mk('meta', 'Meta geral', `Itens mais jogados de ${input.nameOf(champion)} em ${POSITION_LABEL[position]}`, a, {
      runes: runesOf(g, m, 'geral'),
      spells: spellsOf(ctx, 'meta'),
      skills: skillsOf(g, m, 'geral'),
      evidence: { play: core1.play, winRate: core1.play > 0 ? core1.win / core1.play : null, label: `Itens principais: ${sample(core1)} (${core1.from === 'geral' ? 'amostra geral do elo' : 'neste confronto'})` },
      adaptations: adaptationsOf(a.items),
      caveats: caveatsFor(core1, 'nos itens principais')
    })
  }

  /* ---- 2) Meta no confronto ---- */
  if (m && m.cores.length > 0) {
    const firstCore = builds[0]?.items.filter((i) => i.role === 'principal').map((i) => i.id)
    const candidates = [...m.cores].filter((c) => c.play >= MIN_PLAY_BEST).sort((a, b) => shrunk(b.win, b.play) - shrunk(a.win, a.play) || b.play - a.play)
    // prefere um núcleo diferente da build 1 para as opções não serem cópias
    const core2 = candidates.find((c) => !firstCore || !sameSet(c.ids, firstCore)) ?? candidates[0] ?? m.cores[0]!
    const boots = chooseBoots(ctx, ['confronto'], LAMBDA.confronto) ?? chooseBoots(ctx, ['geral'], LAMBDA.confronto)
    let pool = slotPool(ctx, ['confronto'], new Set(core2.ids))
    if (pool.length < 3) pool = slotPool(ctx, ['confronto', 'geral'], new Set(core2.ids))
    const slots = pickBest(ctx, pool, LAMBDA.confronto, 3)
    const a = assemble(ctx, { starter: bestBy(m.starters, 10) ?? g?.starter ?? m.starters[0] ?? null, boots, core: toCand(core2, 'confronto'), slots })
    const opponentName = ctx.opponentName ?? 'o oponente'
    mk('confronto', `Meta contra ${opponentName}`, 'Itens com melhor resultado neste confronto (amostra pequena)', a, {
      runes: runesOf(g, m, 'confronto'),
      spells: spellsOf(ctx, 'confronto'),
      skills: skillsOf(g, m, 'confronto'),
      evidence: { play: core2.play, winRate: core2.play > 0 ? core2.win / core2.play : null, label: `Itens principais: ${sample(core2)} (só partidas contra ${opponentName})` },
      adaptations: adaptationsOf(a.items),
      caveats: [`Dados específicos do confronto: amostras pequenas e sujeitas a ruído.`, ...caveatsFor(core2, 'neste confronto')]
    })
  }

  /* ---- 3) Adaptada aos dois times ---- */
  const coreCands = [g?.core ? toCand(g.core, 'geral') : null, ...(m?.cores.slice(0, 6).map((c) => toCand(c, 'confronto')) ?? [])].filter((c): c is Cand => !!c && c.play >= MIN_PLAY)
  if (coreCands.length > 0) {
    const scored = coreCands
      .map((c) => {
        const f = fitOf(ctx, c)
        return { c, f, u: util(c, f.fit, LAMBDA.adaptada) }
      })
      .sort((x, y) => y.u - x.u)
    const taken = builds.map((b) => b.items.filter((i) => i.role === 'principal').map((i) => i.id))
    const best = scored.find((s) => !taken.some((t) => sameSet(t, s.c.ids))) ?? scored[0]!
    const boots = chooseBoots(ctx, ['geral', 'confronto'], LAMBDA.adaptada)
    const slots = pickBest(ctx, slotPool(ctx, ['geral', 'confronto'], new Set(best.c.ids)), LAMBDA.adaptada, 3)
    const a = assemble(ctx, { starter: g?.starter ?? m?.starters[0] ?? null, boots, core: best.c, slots })
    // motivos do núcleo escolhido também contam como adaptação
    const why = [...best.f.why, ...adaptationsOf(a.items)]
    const sp = spellsOf(ctx, 'adaptada')
    mk('adaptada', 'Adaptada aos times', 'Ajustada à composição aliada e inimiga com itens que jogadores realmente compram', a, {
      runes: runesOf(g, m, 'geral'),
      spells: sp ? { ids: sp.ids, names: sp.names, sample: sp.sample } : null,
      skills: skillsOf(g, m, 'geral'),
      evidence: { play: best.c.play, winRate: best.c.play > 0 ? best.c.win / best.c.play : null, label: `Itens principais: ${sample(best.c)} (${best.c.from === 'geral' ? 'amostra geral do elo' : 'neste confronto'})` },
      adaptations: [...new Set([...why, ...(sp && 'note' in sp && sp.note ? [sp.note] : [])])],
      caveats: [...caveatsFor(best.c, 'nos itens principais'), ...(needs.length === 0 ? ['Os times ainda não pedem ajustes específicos: esta build coincide em grande parte com a meta.'] : [])]
    })
  }

  if (builds.length === 0) warnings.push('Sem dados de builds para este campeão/posição agora.')
  if (builds.length > 0 && builds.length < 3) warnings.push('Menos de 3 builds: faltam dados (por exemplo, o confronto com o oponente de rota).')

  return {
    champion,
    position,
    matchup,
    builds,
    team: {
      allies: { count: Math.round(ally.weight), frontline: ally.frontline, engage: ally.engage, peel: ally.peel, physical: ally.physical },
      enemies: { count: Math.round(enemy.weight), physical: enemy.physical, frontline: enemy.frontline, cc: enemy.cc, dive: enemy.dive, sustain: enemy.sustain }
    },
    warnings
  }
}
