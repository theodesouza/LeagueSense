import { emptyDraft, setSlotChampion, setSlotPosition, setMe } from '@core/draft'
import type { Draft, PickState, Position } from '@core/types'

export interface DemoStep {
  label: string
  draft: Draft
}

type Pick = [index: number, champion: number, state?: PickState]

/** Seleção de exemplo (FICTÍCIA) para o modo demonstração: você é o jogador do meio. */
export function buildDemoSteps(): DemoStep[] {
  const positions: Position[] = ['top', 'jungle', 'mid', 'adc', 'support']
  const base = (): Draft => {
    let d = emptyDraft('demo', 'demo', 'picking')
    positions.forEach((p, i) => (d = setSlotPosition(d, 'ally', i, p)))
    return setMe(d, 2)
  }

  const steps: { label: string; allies?: Pick[]; enemies?: Pick[]; bansA?: number[]; bansE?: number[]; phase?: Draft['phase'] }[] = [
    { label: 'Início da seleção', phase: 'planning' },
    { label: 'Banimentos', bansA: [238, 777, 55], bansE: [99, 517, 875], phase: 'banning' },
    { label: 'Topo aliado confirma; selva está decidindo', bansA: [238, 777, 55, 28, 4], bansE: [99, 517, 875, 84, 7], allies: [[0, 54], [1, 59, 'hover']] },
    { label: 'Inimigo escolhe Yasuo', bansA: [238, 777, 55, 28, 4], bansE: [99, 517, 875, 84, 7], allies: [[0, 54], [1, 59]], enemies: [[0, 157]] },
    { label: 'Suporte aliado confirma; atirador decide', bansA: [238, 777, 55, 28, 4], bansE: [99, 517, 875, 84, 7], allies: [[0, 54], [1, 59], [4, 89], [3, 145, 'hover']], enemies: [[0, 157]] },
    { label: 'Inimigos fecham a bot lane', bansA: [238, 777, 55, 28, 4], bansE: [99, 517, 875, 84, 7], allies: [[0, 54], [1, 59], [4, 89], [3, 145]], enemies: [[0, 157], [3, 222], [4, 412]] },
    { label: 'Sua vez: só falta você', bansA: [238, 777, 55, 28, 4], bansE: [99, 517, 875, 84, 7], allies: [[0, 54], [1, 59], [4, 89], [3, 145]], enemies: [[0, 157], [3, 222], [4, 412], [1, 113], [2, 122]] }
  ]

  return steps.map((s) => {
    let d = base()
    d = { ...d, phase: s.phase ?? 'picking' }
    s.bansA?.forEach((c, i) => (d = setSlotChampion(d, { kind: 'ban', side: 'ally', index: i }, c)))
    s.bansE?.forEach((c, i) => (d = setSlotChampion(d, { kind: 'ban', side: 'enemy', index: i }, c)))
    s.allies?.forEach(([i, c, st]) => (d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: i }, c, st ?? 'locked')))
    s.enemies?.forEach(([i, c, st]) => (d = setSlotChampion(d, { kind: 'pick', side: 'enemy', index: i }, c, st ?? 'locked')))
    return { label: s.label, draft: d }
  })
}
