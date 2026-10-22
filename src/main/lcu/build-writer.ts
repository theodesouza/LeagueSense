import type { ApplyBuildRequest, ApplyResult, ApplyStep, GameflowPhase } from '@shared/api'
import { VISION_ITEMS } from '@core/catalog'
import { LcuHttpError, type LcuHttpLike } from './http'

/**
 * Envio da build ao cliente (conjunto de itens, página de runas, feitiços).
 *
 * Regras de segurança:
 *  - só mexe no que é do LeagueSense: conjuntos de itens e página de runas cujo título/nome começa com
 *    {@link OWNER_PREFIX}; tudo o mais do jogador é preservado e nunca apagado;
 *  - os caminhos usados estão em uma lista fechada (ver `isWriteAllowed` em http.ts);
 *  - feitiços só são alterados durante a seleção de campeões e só se o usuário ligar a opção.
 *
 * Os formatos seguem os tipos gerados do cliente 16.12 (LolItemSetsItemSets, LolPerksPerkPageResource,
 * TeamBuilderDirect_ChampSelectMySelection). NÃO foram testados contra o cliente real.
 */
export const OWNER_PREFIX = 'LeagueSense'
export const SUMMONERS_RIFT = 11

interface ItemSetBlock {
  type: string
  hideIfSummonerSpell: string
  showIfSummonerSpell: string
  items: { id: string; count: number }[]
}
export interface ClientItemSet {
  uid: string
  title: string
  mode: string
  map: string
  type: string
  sortrank: number
  startedFrom: string
  associatedChampions: number[]
  associatedMaps: number[]
  blocks: ItemSetBlock[]
  preferredItemSlots: unknown[]
}
export interface ClientItemSets {
  timestamp: number
  accountId: number
  itemSets: ClientItemSet[]
}
interface ClientPage {
  id: number
  name: string
  isEditable?: boolean
  isDeletable?: boolean
}

const ROLE_BLOCK: Record<ApplyBuildRequest['items'][number]['role'], string> = {
  inicial: 'Iniciais',
  botas: 'Botas',
  principal: 'Itens principais (nesta ordem)',
  situacional: 'Situacionais'
}

const isOwn = (name: unknown): boolean => typeof name === 'string' && name.startsWith(OWNER_PREFIX)

/** Agrupa ids repetidos (ex.: duas poções) em `count`, preservando a ordem. */
function toBlockItems(ids: number[]): { id: string; count: number }[] {
  const order: number[] = []
  const count = new Map<number, number>()
  for (const id of ids) {
    if (!count.has(id)) order.push(id)
    count.set(id, (count.get(id) ?? 0) + 1)
  }
  return order.map((id) => ({ id: String(id), count: count.get(id)! }))
}

export function buildItemSet(req: ApplyBuildRequest, uid: string): ClientItemSet {
  const blocks: ItemSetBlock[] = []
  const add = (type: string, ids: number[]): void => {
    if (ids.length > 0) blocks.push({ type, hideIfSummonerSpell: '', showIfSummonerSpell: '', items: toBlockItems(ids) })
  }
  for (const role of ['inicial', 'botas', 'principal', 'situacional'] as const) {
    const ids = req.items.filter((i) => i.role === role).map((i) => i.id)
    add(ROLE_BLOCK[role], role === 'situacional' || role === 'principal' ? [...new Set(ids)] : ids)
  }
  add('Visão', [...VISION_ITEMS])
  return {
    uid,
    title: `${OWNER_PREFIX} · ${req.championName} · ${req.buildTitle}`.slice(0, 60),
    mode: 'any',
    map: 'any',
    type: 'custom',
    sortrank: 0,
    startedFrom: 'blank',
    associatedChampions: [req.champion],
    associatedMaps: [SUMMONERS_RIFT],
    blocks,
    preferredItemSlots: []
  }
}

/** Mantém tudo do jogador; troca apenas o conjunto do LeagueSense do mesmo campeão. */
export function mergeItemSets(existing: ClientItemSets | null, accountId: number, mine: ClientItemSet): ClientItemSets {
  const champion = mine.associatedChampions[0]
  const kept = (existing?.itemSets ?? []).filter((s) => !(isOwn(s.title) && s.associatedChampions?.includes(champion!)))
  return { timestamp: existing?.timestamp ?? 0, accountId: existing?.accountId || accountId, itemSets: [...kept, mine] }
}

export function pageName(championName: string): string {
  return `${OWNER_PREFIX} ${championName}`.slice(0, 25)
}

export function runePageBody(req: ApplyBuildRequest): { name: string; primaryStyleId: number; subStyleId: number; selectedPerkIds: number[]; current: true } | null {
  const r = req.runes
  if (!r || r.primaryRunes.length !== 4 || r.secondaryRunes.length !== 2 || r.shards.length !== 3) return null
  return {
    name: pageName(req.championName),
    primaryStyleId: r.primaryStyle,
    subStyleId: r.secondaryStyle,
    selectedPerkIds: [...r.primaryRunes, ...r.secondaryRunes, ...r.shards],
    current: true
  }
}

const FLASH = 4
/** Flash na segunda posição (tecla F por padrão no cliente). */
export const orderSpells = (ids: number[]): number[] => (ids[0] === FLASH ? [ids[1]!, ids[0]!] : ids)

function why(e: unknown): string {
  if (e instanceof LcuHttpError) {
    if (e.status === 404) return 'o cliente não reconheceu esse recurso (versão do cliente diferente da esperada)'
    if (e.status === 401 || e.status === 403) return 'o cliente recusou o acesso'
    if (e.status === 400 || e.status === 409 || e.status === 422) return 'o cliente recusou os dados (pode não ser possível alterar neste momento)'
    return `o cliente respondeu HTTP ${e.status}`
  }
  return 'não foi possível falar com o cliente'
}

const done = (steps: ApplyStep[], now: number): ApplyResult => ({ ok: steps.every((s) => s.status !== 'failed'), steps, at: now })
const skipped = (what: ApplyStep['what'], message: string): ApplyStep => ({ what, status: 'skipped', message })

interface Ctx {
  http: LcuHttpLike
  now: () => number
  uid: () => string
}

async function summonerIds(http: LcuHttpLike): Promise<{ summonerId: number; accountId: number }> {
  const s = await http.get<{ summonerId?: unknown; accountId?: unknown }>('/lol-summoner/v1/current-summoner')
  if (typeof s?.summonerId !== 'number') throw new LcuHttpError(404, 'invocador não encontrado')
  return { summonerId: s.summonerId, accountId: typeof s.accountId === 'number' ? s.accountId : 0 }
}

async function sendItems(c: Ctx, req: ApplyBuildRequest): Promise<ApplyStep> {
  try {
    const { summonerId, accountId } = await summonerIds(c.http)
    const path = `/lol-item-sets/v1/item-sets/${summonerId}/sets`
    const existing = await c.http.get<ClientItemSets>(path)
    const mine = buildItemSet(req, c.uid())
    await c.http.send('PUT', path, mergeItemSets(existing, accountId, mine))
    let confirmed = true
    try {
      const after = await c.http.get<ClientItemSets>(path)
      confirmed = !!after?.itemSets?.some((s) => s.uid === mine.uid)
    } catch {
      /* sem confirmação: segue como enviado */
    }
    if (!confirmed) return { what: 'items', status: 'failed', message: 'O cliente aceitou o envio, mas o conjunto de itens não apareceu na conferência.' }
    return { what: 'items', status: 'ok', message: `Conjunto de itens «${mine.title}» salvo no cliente (aparece na loja, em "Conjuntos de itens").` }
  } catch (e) {
    return { what: 'items', status: 'failed', message: `Não consegui salvar o conjunto de itens: ${why(e)}.` }
  }
}

async function sendRunes(c: Ctx, req: ApplyBuildRequest): Promise<ApplyStep> {
  const body = runePageBody(req)
  if (!body) return skipped('runes', 'Esta build não tem uma página de runas completa para enviar.')
  try {
    const pages = (await c.http.get<ClientPage[]>('/lol-perks/v1/pages')) ?? []
    const own = pages.find((p) => isOwn(p.name) && p.isEditable !== false)
    let id: number
    if (own) {
      await c.http.send('PUT', `/lol-perks/v1/pages/${own.id}`, body)
      id = own.id
    } else {
      const inv = await c.http.get<{ canAddCustomPage?: boolean }>('/lol-perks/v1/inventory')
      if (inv && inv.canAddCustomPage === false) {
        return {
          what: 'runes',
          status: 'failed',
          message: 'Não há espaço para uma nova página de runas. Apague uma página no cliente e envie de novo (o LeagueSense nunca apaga suas páginas).'
        }
      }
      const created = await c.http.send<{ id?: unknown }>('POST', '/lol-perks/v1/pages', body)
      if (typeof created?.id !== 'number') return { what: 'runes', status: 'failed', message: 'O cliente não confirmou a criação da página de runas.' }
      id = created.id
    }
    await c.http.send('PUT', '/lol-perks/v1/currentpage', id)
    return { what: 'runes', status: 'ok', message: `Página de runas «${body.name}» ${own ? 'atualizada' : 'criada'} e selecionada.` }
  } catch (e) {
    return { what: 'runes', status: 'failed', message: `Não consegui salvar a página de runas: ${why(e)}.` }
  }
}

async function sendSpells(c: Ctx, req: ApplyBuildRequest, phase: GameflowPhase): Promise<ApplyStep> {
  if (!req.spells || req.spells.length !== 2) return skipped('spells', 'Esta build não traz dois feitiços de invocador.')
  if (phase !== 'ChampSelect') return skipped('spells', 'Feitiços só podem ser trocados durante a seleção de campeões; nada foi alterado.')
  const [spell1Id, spell2Id] = orderSpells(req.spells) as [number, number]
  try {
    await c.http.send('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id, spell2Id })
    return { what: 'spells', status: 'ok', message: 'Feitiços de invocador definidos (Flash fica na segunda posição).' }
  } catch (e) {
    return { what: 'spells', status: 'failed', message: `Não consegui definir os feitiços: ${why(e)}.` }
  }
}

export interface WriterDeps {
  now?: () => number
  uid?: () => string
}

const defaultUid = (): string => `ls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export async function applyBuild(http: LcuHttpLike, req: ApplyBuildRequest, phase: GameflowPhase, deps: WriterDeps = {}): Promise<ApplyResult> {
  const c: Ctx = { http, now: deps.now ?? Date.now, uid: deps.uid ?? defaultUid }
  const steps: ApplyStep[] = []
  // etapas independentes: uma falha não impede as outras
  if (req.options.items) steps.push(await sendItems(c, req))
  if (req.options.runes) steps.push(await sendRunes(c, req))
  if (req.options.spells) steps.push(await sendSpells(c, req, phase))
  if (steps.length === 0) steps.push(skipped('items', 'Nada selecionado para enviar.'))
  return done(steps, c.now())
}

/** Remove só o que o LeagueSense criou (conjuntos de itens e página de runas com o nosso prefixo). */
export async function clearOwned(http: LcuHttpLike, deps: WriterDeps = {}): Promise<ApplyResult> {
  const now = deps.now ?? Date.now
  const steps: ApplyStep[] = []
  try {
    const { summonerId, accountId } = await summonerIds(http)
    const path = `/lol-item-sets/v1/item-sets/${summonerId}/sets`
    const existing = await http.get<ClientItemSets>(path)
    const mine = (existing?.itemSets ?? []).filter((s) => isOwn(s.title))
    if (existing && mine.length > 0) {
      await http.send('PUT', path, { timestamp: existing.timestamp, accountId: existing.accountId || accountId, itemSets: existing.itemSets.filter((s) => !isOwn(s.title)) })
    }
    steps.push({ what: 'items', status: 'ok', message: mine.length > 0 ? `${mine.length} conjunto(s) de itens do LeagueSense removido(s).` : 'Nenhum conjunto de itens do LeagueSense no cliente.' })
  } catch (e) {
    steps.push({ what: 'items', status: 'failed', message: `Não consegui remover os conjuntos de itens: ${why(e)}.` })
  }
  try {
    const pages = (await http.get<ClientPage[]>('/lol-perks/v1/pages')) ?? []
    const own = pages.filter((p) => isOwn(p.name) && p.isDeletable !== false)
    for (const p of own) await http.send('DELETE', `/lol-perks/v1/pages/${p.id}`)
    steps.push({ what: 'runes', status: 'ok', message: own.length > 0 ? `${own.length} página(s) de runas do LeagueSense removida(s).` : 'Nenhuma página de runas do LeagueSense no cliente.' })
  } catch (e) {
    steps.push({ what: 'runes', status: 'failed', message: `Não consegui remover a página de runas: ${why(e)}.` })
  }
  return done(steps, now())
}
