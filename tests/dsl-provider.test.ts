import { describe, expect, it } from 'vitest'
import { DslParseError, parseDsl } from '../src/main/sources/opgg/dsl'
import { OpggProvider, normalizeName, opggParam } from '../src/main/sources/opgg/provider'
import { SourceFailure } from '../src/main/errors'
import type { McpLike } from '../src/main/sources/opgg/mcp'
import { ANALYSIS_BUILD, GUIDE_REAL } from './fixtures/opgg-builds'
import { ANALYSIS_BASE, CHAMPION_LIST, LANE_META, MATCHUP_JSON, PATCH_PROBE, SYNERGIES } from './fixtures/opgg'

describe('parseDsl', () => {
  it('lê classes, listas e instâncias aninhadas', () => {
    const v = parseDsl(`class A: x,y\nclass B: n\n\nA([B(1),B(2.5)],"ok")`) as any
    expect(v).toEqual({ x: [{ n: 1 }, { n: 2.5 }], y: 'ok' })
  })

  it('strings com aspas escapadas, vírgulas, parênteses e unicode', () => {
    const v = parseDsl(`class A: s\n\nA("Kai'Sa, \\"x\\" (y) \\u00e9")`) as any
    expect(v.s).toBe(`Kai'Sa, "x" (y) é`)
  })

  it('números negativos/exponencial, booleanos e null', () => {
    const v = parseDsl(`class A: a,b,c,d,e\n\nA(-1,2.5e2,true,false,null)`) as any
    expect(v).toEqual({ a: -1, b: 250, c: true, d: false, e: null })
  })

  it('campos sem declaração viram _N; listas vazias e objetos vazios funcionam', () => {
    expect(parseDsl(`A(1,[])`)).toEqual({ _0: 1, _1: [] })
    expect(parseDsl(`class A: x\n\nA()`)).toEqual({})
  })

  it('falha com mensagem útil em entrada malformada', () => {
    expect(() => parseDsl('class A: x\n\nA(1,')).toThrow(DslParseError)
    expect(() => parseDsl('class A: x\n\nA("abc)')).toThrow(/string/)
    expect(() => parseDsl('class A: x\n\nA(1) lixo')).toThrow(/após/)
    expect(() => parseDsl('')).toThrow(DslParseError)
  })

  it('limita aninhamento (entrada hostil não estoura a pilha)', () => {
    const deep = 'A('.repeat(500) + ')'.repeat(500)
    expect(() => parseDsl(deep)).toThrow(DslParseError)
  })
})

describe('nomes de parâmetros do OP.GG', () => {
  it.each([
    ['LeeSin', 'LEE_SIN'],
    ['KSante', 'K_SANTE'],
    ['MonkeyKing', 'MONKEY_KING'],
    ['Kaisa', 'KAISA'],
    ['TwistedFate', 'TWISTED_FATE'],
    ['DrMundo', 'DR_MUNDO'],
    ['AurelionSol', 'AURELION_SOL'],
    ['Nunu', 'NUNU'],
    ['Velkoz', 'VELKOZ']
  ])('%s → %s', (key, expected) => expect(opggParam(key)).toBe(expected))

  it('normaliza nomes para casar listas', () => {
    expect(normalizeName("Kai'Sa")).toBe('kaisa')
    expect(normalizeName('Nunu & Willump')).toBe('nunuwillump')
  })
})

class FakeMcp implements McpLike {
  calls: { name: string; args: Record<string, unknown> }[] = []
  constructor(private readonly responses: Record<string, string | Error>) {}
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    this.calls.push({ name, args })
    const r = this.responses[name]
    if (r instanceof Error) throw r
    if (r == null) throw new Error(`sem resposta para ${name}`)
    return r
  }
}

describe('OpggProvider', () => {
  const mk = (over: Record<string, string | Error> = {}) =>
    new OpggProvider(
      new FakeMcp({
        lol_list_champions: CHAMPION_LIST,
        lol_list_lane_meta_champions: LANE_META,
        lol_get_champion_analysis: ANALYSIS_BASE,
        lol_get_lane_matchup_guide: MATCHUP_JSON,
        lol_get_champion_synergies: SYNERGIES,
        ...over
      })
    )

  it('laneMeta: casa nomes com ids, ignora desconhecidos e modos especiais, preenche roleRates', async () => {
    const p = mk()
    const m = await p.laneMeta()
    expect(m.byPosition.mid![103]).toMatchObject({ play: 22867, win: 11614, roleRate: 0.95 })
    expect(m.byPosition.jungle![20]).toBeDefined() // "Nunu & Willump"
    expect(m.byPosition.top![62]).toBeDefined() // Wukong ↔ MonkeyKing pelo id
    expect(m.byPosition.adc![145]).toBeDefined() // Kai'Sa
    expect(m.roleRates[157]).toEqual({ mid: 0.59 })
    expect([...p.unmatched]).toEqual(['Campeao Inexistente'])
  })

  it('baseAtTier: reconstrói vitórias de taxa arredondada e marca como arredondado; extrai patch', async () => {
    const r = await mk().baseAtTier(103, 'mid', 'GOLD')
    expect(r.stat.play).toBe(16511)
    expect(r.stat.win).toBe(Math.round(16511 * 0.51))
    expect(r.stat.rounded).toBe(true)
    expect(r.patch).toBe('16.21')
  })

  it('envia o parâmetro de elo e o nome no formato do servidor', async () => {
    const mcp = new FakeMcp({ lol_list_champions: CHAMPION_LIST, lol_get_champion_analysis: ANALYSIS_BASE })
    await new OpggProvider(mcp).baseAtTier(62, 'top', 'EMERALD_PLUS')
    const call = mcp.calls.find((c) => c.name === 'lol_get_champion_analysis')!
    expect(call.args).toMatchObject({ champion: 'MONKEY_KING', position: 'top', tier: 'EMERALD_PLUS', game_mode: 'ranked' })
  })

  it('matchups: tabela por id do oponente; descarta linhas sem partidas', async () => {
    const t = await mk().matchups(103, 'mid')
    expect(t.entries[157]).toEqual({ play: 776, win: 378 })
    expect(t.entries[1]).toBeUndefined()
    expect(t.patch).toBe('16.21')
  })

  it('synergies: por id do parceiro', async () => {
    const t = await mk().synergies(103, 'mid', 'support')
    expect(t.entries[412]).toEqual({ play: 360, win: 196 })
  })

  it('patch: lê a versão', async () => {
    expect(await mk({ lol_get_champion_analysis: PATCH_PROBE }).patch({ champion: 103, position: 'mid' })).toBe('16.21')
  })

  it('patch: trends vazio (servidor recomputando) é erro explícito, não "sem patch"', async () => {
    const empty = 'class A: data\nclass Data: trends\nclass Trends: win\n\nA(Data(Trends([])))'
    await expect(mk({ lol_get_champion_analysis: empty }).patch({ champion: 103, position: 'mid' })).rejects.toMatchObject({ kind: 'validation' })
  })

  it('formato inesperado vira SourceFailure(validation/parse), não exceção genérica', async () => {
    await expect(mk({ lol_list_lane_meta_champions: 'class X: a\n\nX(1)' }).laneMeta()).rejects.toMatchObject({ kind: 'validation' })
    await expect(mk({ lol_list_lane_meta_champions: 'isto não é DSL ((' }).laneMeta()).rejects.toBeInstanceOf(SourceFailure)
    await expect(mk({ lol_get_lane_matchup_guide: '<html>erro</html>' }).matchups(103, 'mid')).rejects.toMatchObject({ kind: 'parse' })
  })

  it('campeão desconhecido do OP.GG falha com mensagem clara', async () => {
    await expect(mk().matchups(99999, 'mid')).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('OpggProvider: builds', () => {
  const mk = (over: Record<string, string | Error> = {}) =>
    new OpggProvider(
      new FakeMcp({
        lol_list_champions: CHAMPION_LIST,
        lol_get_champion_analysis: ANALYSIS_BUILD,
        lol_get_lane_matchup_guide: GUIDE_REAL,
        ...over
      })
    )

  it('buildGeneral: lê itens, botas, iniciais, runas, habilidades e patch de uma resposta real', async () => {
    const g = await mk().buildGeneral(103, 'mid', 'EMERALD_PLUS')
    expect(g.damageType).toBe('AP')
    expect(g.core?.ids).toEqual([3118, 4645, 3157])
    expect(g.boots?.ids).toEqual([3020])
    expect(g.starter?.ids).toEqual([1056, 2003, 2003])
    expect(g.slot4.length).toBeGreaterThan(0)
    expect(g.slot4[0]!.ids).toEqual([3089])
    expect(g.spells?.ids).toEqual([4, 14])
    expect(g.runes?.primaryRunes.length).toBe(4)
    expect(g.runes?.secondaryRunes.length).toBe(2)
    expect(g.runes?.shards.length).toBe(3)
    expect(g.skills?.order.length).toBeGreaterThanOrEqual(9)
    expect(g.patch).toBeNull() // a captura real não pediu trends: sem patch, sem inventar
  })

  it('buildGeneral: patch vem de trends.win quando presente', async () => {
    const g = await mk({ lol_get_champion_analysis: ANALYSIS_BASE }).buildGeneral(103, 'mid', 'EMERALD_PLUS')
    expect(g.patch).toBe('16.21')
  })

  it('buildGeneral: envia elo e campos pedidos', async () => {
    const mcp = new FakeMcp({ lol_list_champions: CHAMPION_LIST, lol_get_champion_analysis: ANALYSIS_BUILD })
    await new OpggProvider(mcp).buildGeneral(103, 'mid', 'DIAMOND_PLUS')
    const call = mcp.calls.find((c) => c.name === 'lol_get_champion_analysis')!
    expect(call.args).toMatchObject({ champion: 'AHRI', position: 'mid', tier: 'DIAMOND_PLUS' })
    expect(JSON.stringify(call.args['desired_output_fields'])).toContain('core_items')
  })

  it('matchupGuide: mapeia vantagens para "eu"/"oponente", registro do confronto e dica em inglês', async () => {
    const m = await mk().matchupGuide(103, 238, 'mid')
    expect(m.opponent).toBe(238)
    expect(m.cores.length).toBeGreaterThan(0)
    expect(m.cores[0]!.ids.length).toBe(3)
    expect(m.singles[0]!.length).toBeGreaterThan(0)
    expect(m.record).not.toBeNull()
    expect(m.record!.play).toBeGreaterThan(0)
    expect(m.laneAdvantage).toBe('opponent') // "Zed" na resposta real
    expect(m.tipEn).toMatch(/Zed/)
    expect(['aggressive', 'defensive', 'even']).toContain(m.playStyle)
    expect(m.gameLengths.length).toBeGreaterThan(0)
  })

  it('matchupGuide: resposta que não é JSON vira falha explícita', async () => {
    await expect(mk({ lol_get_lane_matchup_guide: 'não é json' }).matchupGuide(103, 238, 'mid')).rejects.toMatchObject({ kind: 'parse' })
  })

  it('buildGeneral: formato inesperado vira validation', async () => {
    await expect(mk({ lol_get_champion_analysis: 'class A: x\n\nA(1)' }).buildGeneral(103, 'mid', 'EMERALD_PLUS')).rejects.toBeInstanceOf(SourceFailure)
  })
})
