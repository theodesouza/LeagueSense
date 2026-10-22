import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApplyBuildRequest } from '@shared/api'
import { LcuHttp, isWriteAllowed } from '../src/main/lcu/http'
import { OWNER_PREFIX, applyBuild, buildItemSet, clearOwned, mergeItemSets, orderSpells, pageName, runePageBody } from '../src/main/lcu/build-writer'
import { FakeLcu } from './helpers/fake-lcu'

const req = (over: Partial<ApplyBuildRequest> = {}): ApplyBuildRequest => ({
  champion: 103,
  championName: 'Ahri',
  buildTitle: 'Meta geral',
  items: [
    { id: 1056, role: 'inicial' },
    { id: 2003, role: 'inicial' },
    { id: 2003, role: 'inicial' },
    { id: 3020, role: 'botas' },
    { id: 6655, role: 'principal' },
    { id: 3157, role: 'principal' },
    { id: 3089, role: 'principal' },
    { id: 3135, role: 'situacional' },
    { id: 3135, role: 'situacional' },
    { id: 3165, role: 'situacional' }
  ],
  runes: { primaryStyle: 8100, primaryRunes: [8112, 8126, 8138, 8135], secondaryStyle: 8200, secondaryRunes: [8226, 8210], shards: [5008, 5008, 5011] },
  spells: [4, 14],
  options: { items: true, runes: true, spells: false },
  ...over
})

describe('conteúdo enviado', () => {
  it('monta blocos do arsenal: iniciais (com contagem), botas, principais, situacionais e visão', () => {
    const set = buildItemSet(req(), 'uid-1')
    expect(set.blocks.map((b) => b.type)).toEqual(['Iniciais', 'Botas', 'Itens principais (nesta ordem)', 'Situacionais', 'Visão'])
    expect(set.blocks[0]!.items).toEqual([
      { id: '1056', count: 1 },
      { id: '2003', count: 2 }
    ])
    expect(set.blocks[3]!.items.map((i) => i.id)).toEqual(['3135', '3165']) // sem repetidos
    expect(set.blocks[4]!.items.map((i) => i.id)).toEqual(['3340', '2055'])
    expect(set.title.startsWith(OWNER_PREFIX)).toBe(true)
    expect(set.associatedChampions).toEqual([103])
    expect(set.associatedMaps).toEqual([11])
  })

  it('omite blocos vazios', () => {
    const set = buildItemSet(req({ items: [{ id: 3089, role: 'principal' }] }), 'u')
    expect(set.blocks.map((b) => b.type)).toEqual(['Itens principais (nesta ordem)', 'Visão'])
  })

  it('merge preserva conjuntos do jogador e troca só o do mesmo campeão com nosso prefixo', () => {
    const mine = buildItemSet(req(), 'novo')
    const other = { uid: 'u-user', title: 'Meu set', associatedChampions: [103], blocks: [] }
    const oldOwn = { uid: 'velho', title: `${OWNER_PREFIX} · Ahri · Adaptada`, associatedChampions: [103], blocks: [] }
    const ownOtherChamp = { uid: 'outro', title: `${OWNER_PREFIX} · Zed · Meta`, associatedChampions: [238], blocks: [] }
    const merged = mergeItemSets({ timestamp: 5, accountId: 777, itemSets: [other, oldOwn, ownOtherChamp] as never }, 1, mine)
    expect(merged.itemSets.map((s) => s.uid)).toEqual(['u-user', 'outro', 'novo'])
    expect(merged.accountId).toBe(777)
    expect(merged.timestamp).toBe(5)
  })

  it('página de runas: 9 ids na ordem (principais, secundárias, fragmentos) e nome curto com prefixo', () => {
    const b = runePageBody(req())!
    expect(b.selectedPerkIds).toEqual([8112, 8126, 8138, 8135, 8226, 8210, 5008, 5008, 5011])
    expect(b.current).toBe(true)
    expect(pageName('Aurelion Sol').length).toBeLessThanOrEqual(25)
    expect(pageName('Aurelion Sol').startsWith(OWNER_PREFIX)).toBe(true)
    expect(runePageBody(req({ runes: { primaryStyle: 8100, primaryRunes: [1, 2, 3], secondaryStyle: 8200, secondaryRunes: [4, 5], shards: [5008, 5008, 5011] } }))).toBeNull()
    expect(runePageBody(req({ runes: null }))).toBeNull()
  })

  it('Flash fica na segunda posição', () => {
    expect(orderSpells([4, 14])).toEqual([14, 4])
    expect(orderSpells([14, 4])).toEqual([14, 4])
    expect(orderSpells([7, 14])).toEqual([7, 14])
  })

  it('lista fechada de escritas', () => {
    expect(isWriteAllowed('PUT', '/lol-item-sets/v1/item-sets/4242/sets')).toBe(true)
    expect(isWriteAllowed('POST', '/lol-perks/v1/pages')).toBe(true)
    expect(isWriteAllowed('DELETE', '/lol-perks/v1/pages/12')).toBe(true)
    expect(isWriteAllowed('PATCH', '/lol-champ-select/v1/session/my-selection')).toBe(true)
    expect(isWriteAllowed('DELETE', '/lol-perks/v1/pages')).toBe(false) // apagaria todas as páginas
    expect(isWriteAllowed('POST', '/lol-lobby/v2/lobby')).toBe(false)
    expect(isWriteAllowed('PUT', '/lol-champ-select/v1/session/actions/1')).toBe(false) // nunca escolher/banir
    expect(isWriteAllowed('PATCH', '/lol-champ-select/v1/session/my-selection/../actions/1')).toBe(false)
  })
})

describe('envio ao cliente (LCU falso, HTTP real)', () => {
  let lcu: FakeLcu
  let http: LcuHttp
  beforeEach(async () => {
    lcu = new FakeLcu()
    await lcu.start()
    http = new LcuHttp({ port: lcu.port, password: lcu.token, scheme: 'http', source: 'lockfile' })
  })
  afterEach(async () => {
    http.close()
    await lcu.close()
  })

  it('cria o conjunto de itens e a página de runas e seleciona a página', async () => {
    const r = await applyBuild(http, req(), 'Lobby', { uid: () => 'uid-1' })
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => [s.what, s.status])).toEqual([
      ['items', 'ok'],
      ['runes', 'ok']
    ])
    expect(lcu.itemSets.itemSets).toHaveLength(1)
    expect(lcu.itemSets.itemSets[0]!['uid']).toBe('uid-1')
    expect(lcu.pages).toHaveLength(1)
    expect(lcu.pages[0]!.name.startsWith(OWNER_PREFIX)).toBe(true)
    expect(lcu.currentPage).toBe(lcu.pages[0]!.id)
    expect(lcu.mySelection).toBeNull() // feitiços desligados por padrão
  })

  it('reenviar atualiza no lugar: continua com 1 conjunto e 1 página (sem acumular)', async () => {
    await applyBuild(http, req(), 'Lobby', { uid: () => 'a' })
    await applyBuild(http, req({ buildTitle: 'Adaptada aos times' }), 'Lobby', { uid: () => 'b' })
    expect(lcu.itemSets.itemSets.map((s) => s['uid'])).toEqual(['b'])
    expect(lcu.pages).toHaveLength(1)
    expect(String(lcu.itemSets.itemSets[0]!['title'])).toContain('Adaptada')
  })

  it('preserva conjuntos e páginas do jogador', async () => {
    lcu.itemSets.itemSets = [{ uid: 'meu', title: 'Meu conjunto', associatedChampions: [103], blocks: [] }]
    lcu.pages = [{ id: 1, name: 'Minha página', isEditable: true, isDeletable: true }]
    await applyBuild(http, req(), 'Lobby', { uid: () => 'x' })
    expect(lcu.itemSets.itemSets.map((s) => s['uid'])).toEqual(['meu', 'x'])
    expect(lcu.pages.map((p) => p.name)).toContain('Minha página')
    expect(lcu.writes.filter((w) => w.method === 'DELETE')).toHaveLength(0)
  })

  it('sem espaço para página de runas: falha explicada e nunca apaga páginas do jogador', async () => {
    lcu.pageCapacity = 2
    lcu.pages = [
      { id: 1, name: 'A', isEditable: true, isDeletable: true },
      { id: 2, name: 'B', isEditable: true, isDeletable: true }
    ]
    const r = await applyBuild(http, req(), 'Lobby', { uid: () => 'x' })
    const runes = r.steps.find((s) => s.what === 'runes')!
    expect(runes.status).toBe('failed')
    expect(runes.message).toMatch(/espaço/)
    expect(r.steps.find((s) => s.what === 'items')!.status).toBe('ok') // etapa independente
    expect(r.ok).toBe(false)
    expect(lcu.pages).toHaveLength(2)
    expect(lcu.writes.some((w) => w.method === 'DELETE')).toBe(false)
  })

  it('cliente recusa uma etapa: as outras seguem e o erro é explicado', async () => {
    lcu.failWrites.set(`/lol-item-sets/v1/item-sets/${lcu.summoner.summonerId}/sets`, 400)
    const r = await applyBuild(http, req(), 'Lobby', { uid: () => 'x' })
    expect(r.steps[0]).toMatchObject({ what: 'items', status: 'failed' })
    expect(r.steps[0]!.message).toMatch(/recusou/)
    expect(r.steps[1]).toMatchObject({ what: 'runes', status: 'ok' })
  })

  it('feitiços: só na seleção de campeões e só se a opção estiver ligada', async () => {
    const off = await applyBuild(http, req({ options: { items: false, runes: false, spells: true } }), 'Lobby')
    expect(off.steps[0]).toMatchObject({ what: 'spells', status: 'skipped' })
    expect(lcu.mySelection).toBeNull()
    lcu.phase = 'ChampSelect'
    const on = await applyBuild(http, req({ options: { items: false, runes: false, spells: true } }), 'ChampSelect')
    expect(on.steps[0]).toMatchObject({ what: 'spells', status: 'ok' })
    expect(lcu.mySelection).toEqual({ spell1Id: 14, spell2Id: 4 })
  })

  it('remove apenas o que é do LeagueSense', async () => {
    lcu.itemSets.itemSets = [{ uid: 'meu', title: 'Meu conjunto', associatedChampions: [103], blocks: [] }]
    lcu.pages = [{ id: 1, name: 'Minha página', isEditable: true, isDeletable: true }]
    await applyBuild(http, req(), 'Lobby', { uid: () => 'x' })
    const r = await clearOwned(http)
    expect(r.ok).toBe(true)
    expect(lcu.itemSets.itemSets.map((s) => s['uid'])).toEqual(['meu'])
    expect(lcu.pages.map((p) => p.name)).toEqual(['Minha página'])
  })

  it('recusa escritas fora da lista antes de enviar', async () => {
    await expect(http.send('POST', '/lol-lobby/v2/lobby', {})).rejects.toThrow(/não permitida/)
    expect(lcu.writes).toHaveLength(0)
  })

  it('não envia nada quando todas as opções estão desligadas', async () => {
    const r = await applyBuild(http, req({ options: { items: false, runes: false, spells: false } }), 'Lobby')
    expect(r.steps[0]!.status).toBe('skipped')
    expect(lcu.writes).toHaveLength(0)
  })
})

