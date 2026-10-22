import { describe, expect, it } from 'vitest'
import { inferPositions } from '@core/positions'
import { rankStable } from '@core/rank'
import {
  championsInDraft,
  emptyDraft,
  lockedBans,
  setMe,
  setSlotChampion,
  setSlotPosition,
  setSlotState,
  unavailableChampions
} from '@core/draft'

describe('inferPositions', () => {
  const rates = {
    1: { top: 0.9, mid: 0.1 },
    2: { mid: 0.5, top: 0.5 },
    3: { support: 0.95 },
    4: { jungle: 0.97 },
    5: { adc: 0.98 }
  }

  it('posições declaradas são fixas e probabilidade 1', () => {
    const [a] = inferPositions([{ champion: 2, declared: 'mid' }], rates)
    expect(a!.best).toBe('mid')
    expect(a!.bestProbability).toBe(1)
    expect(a!.declared).toBe(true)
  })

  it('campeão flexível ocupa a posição que sobra quando o resto do time é rígido', () => {
    // 1 é quase sempre top; 2 é 50/50 top/mid → 2 vai para mid com alta probabilidade
    const out = inferPositions(
      [
        { champion: 1, declared: null },
        { champion: 2, declared: null },
        { champion: 3, declared: null },
        { champion: 4, declared: null },
        { champion: 5, declared: null }
      ],
      rates
    )
    expect(out[1]!.best).toBe('mid')
    expect(out[1]!.bestProbability).toBeGreaterThan(0.8)
    // cada posição soma 1 no time (permutação)
    for (const pos of ['top', 'jungle', 'mid', 'adc', 'support'] as const) {
      expect(out.reduce((a, o) => a + o.byPosition[pos], 0)).toBeCloseTo(1, 6)
    }
  })

  it('flexível sozinho mantém a incerteza (≈ 50%)', () => {
    const [a] = inferPositions([{ champion: 2, declared: null }], rates)
    expect(a!.byPosition.mid).toBeGreaterThan(0.4)
    expect(a!.byPosition.top).toBeGreaterThan(0.4)
    expect(a!.bestProbability).toBeLessThan(0.6)
  })

  it('campeão sem dados é uniforme; entradas vazias ficam vazias', () => {
    const out = inferPositions([{ champion: 99, declared: null }, { champion: null, declared: null }], rates)
    expect(out[0]!.byPosition.top).toBeCloseTo(0.2, 6)
    expect(out[1]!.best).toBeNull()
  })

  it('declarações duplicadas não quebram', () => {
    const out = inferPositions(
      [{ champion: 1, declared: 'top' }, { champion: 2, declared: 'top' }],
      rates
    )
    expect(out[0]!.byPosition.top).toBe(1)
    expect(out[1]!.byPosition.top).toBe(0)
    expect(out[1]!.best).not.toBe('top')
  })
})

describe('rankStable (histerese)', () => {
  const mk = (id: number, score: number) => ({ championId: id, score, totalPp: score })
  it('sem histórico, ordena por pontuação', () => {
    expect(rankStable([mk(1, 50), mk(2, 70), mk(3, 60)]).map((i) => i.championId)).toEqual([2, 3, 1])
  })
  it('oscilação pequena não reordena', () => {
    const prev = [2, 3, 1]
    const out = rankStable([mk(1, 59.9), mk(2, 69.8), mk(3, 70.0)], prev, 0.6)
    expect(out.map((i) => i.championId)).toEqual([2, 3, 1])
  })
  it('diferença grande reordena', () => {
    const out = rankStable([mk(1, 80), mk(2, 70), mk(3, 60)], [2, 3, 1], 0.6)
    expect(out.map((i) => i.championId)).toEqual([1, 2, 3])
  })
  it('novos itens entram sem quebrar a ordem anterior', () => {
    const out = rankStable([mk(1, 70), mk(2, 70.2), mk(9, 70.1)], [1, 2], 0.6)
    expect(out.map((i) => i.championId)).toEqual([1, 2, 9])
  })
})

describe('draft', () => {
  it('banidos e escolhidos confirmados ficam indisponíveis; hover não', () => {
    let d = emptyDraft('x', 'manual')
    d = setSlotChampion(d, { kind: 'pick', side: 'enemy', index: 0 }, 10, 'locked')
    d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 1 }, 20, 'hover')
    d = setSlotChampion(d, { kind: 'ban', side: 'ally', index: 0 }, 30)
    d = setSlotChampion(d, { kind: 'ban', side: 'enemy', index: 0 }, 40, 'hover')
    const un = unavailableChampions(d)
    expect([...un].sort()).toEqual([10, 30])
    expect(lockedBans(d)).toEqual([30])
    expect(championsInDraft(d).size).toBe(4)
  })

  it('colocar um campeão já presente o move (sem duplicatas)', () => {
    let d = emptyDraft('x', 'manual')
    d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 0 }, 10)
    d = setSlotChampion(d, { kind: 'ban', side: 'enemy', index: 2 }, 10)
    expect(d.allies[0]!.champion).toBeNull()
    expect(d.bansEnemies[2]!.champion).toBe(10)
  })

  it('edição não altera o objeto original (imutável)', () => {
    const d = emptyDraft('x', 'manual')
    const d2 = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 0 }, 5)
    expect(d.allies[0]!.champion).toBeNull()
    expect(d2.allies[0]!.champion).toBe(5)
  })

  it('posição manual é exclusiva por time', () => {
    let d = emptyDraft('x', 'manual')
    d = setSlotPosition(d, 'enemy', 0, 'mid')
    d = setSlotPosition(d, 'enemy', 3, 'mid')
    expect(d.enemies[0]!.position).toBeNull()
    expect(d.enemies[3]!.position).toBe('mid')
  })

  it('muda estado de confirmado para temporário e define "eu"', () => {
    let d = emptyDraft('x', 'manual')
    d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 2 }, 7, 'locked')
    d = setSlotState(d, { kind: 'pick', side: 'ally', index: 2 }, 'hover')
    expect(d.allies[2]!.state).toBe('hover')
    d = setMe(d, 2)
    expect(d.allies.map((s) => s.isMe)).toEqual([false, false, true, false, false])
  })
})
