import { describe, expect, it } from 'vitest'
import { emptyDraft, setSlotChampion, setMe } from '@core/draft'
import { membersOf, resolveFocus } from '@core/focus'
import type { Draft } from '@core/types'
import { neutralTraits } from './helpers'

const nameOf = (id: number): string => `C${id}`
const base = (): Draft => setMe(emptyDraft('d', 'manual', 'picking'), 0)
const withMe = (d: Draft, champion: number, state: 'locked' | 'hover'): Draft => setSlotChampion(d, { kind: 'pick', side: 'ally', index: 0 }, champion, state)

describe('foco do plano de jogo', () => {
  it('sem nada escolhido, segue a melhor recomendação', () => {
    expect(resolveFocus({ draft: base(), myPick: null, top: 10, nameOf })).toEqual({ champion: 10, source: 'sugestao', note: null })
    expect(resolveFocus({ draft: base(), myPick: null, top: null, nameOf })).toBeNull()
  })

  it('escolha feita no app vale sobre a sugestão', () => {
    expect(resolveFocus({ draft: base(), myPick: 7, top: 10, nameOf })).toMatchObject({ champion: 7, source: 'escolhido' })
  })

  it('provisório no cliente vale sobre a sugestão, mas não sobre a escolha do app', () => {
    const d = withMe(base(), 5, 'hover')
    expect(resolveFocus({ draft: d, myPick: null, top: 10, nameOf })).toMatchObject({ champion: 5, source: 'provisorio' })
    expect(resolveFocus({ draft: d, myPick: 7, top: 10, nameOf })).toMatchObject({ champion: 7, source: 'escolhido' })
  })

  it('o que travei no cliente vence tudo, e avisa se difere da escolha do app', () => {
    const d = withMe(base(), 5, 'locked')
    expect(resolveFocus({ draft: d, myPick: 7, top: 10, nameOf })).toMatchObject({ champion: 5, source: 'travado', note: expect.stringContaining('travou') })
    expect(resolveFocus({ draft: d, myPick: 5, top: 10, nameOf })).toMatchObject({ champion: 5, source: 'travado', note: null })
  })

  it('escolha do app que ficou indisponível (banida ou escolhida por outro) é ignorada com aviso', () => {
    let d = base()
    d = setSlotChampion(d, { kind: 'ban', side: 'enemy', index: 0 }, 7, 'locked')
    const r = resolveFocus({ draft: d, myPick: 7, top: 10, nameOf })
    expect(r).toMatchObject({ champion: 10, source: 'sugestao' })
    expect(r?.note).toMatch(/não está mais disponível/)
    const d2 = setSlotChampion(base(), { kind: 'pick', side: 'enemy', index: 1 }, 7, 'locked')
    expect(resolveFocus({ draft: d2, myPick: 7, top: null, nameOf })).toBeNull()
  })
})

describe('membros dos times', () => {
  it('ignora vazios e o próprio jogador, com peso menor para provisórios', () => {
    let d = withMe(base(), 5, 'locked')
    d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 1 }, 6, 'locked')
    d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 2 }, 8, 'hover')
    d = setSlotChampion(d, { kind: 'pick', side: 'enemy', index: 0 }, 9, 'locked')
    const m = membersOf(d, () => neutralTraits())
    expect(m.allies.map((x) => [x.champion, x.weight < 1])).toEqual([[6, false], [8, true]])
    expect(m.enemies.map((x) => x.champion)).toEqual([9])
  })
})
