import { CONFIG } from './config'
import { fmtPct0 } from './format'
import { clamp } from './stats'
import type { ChampionTraits } from './traits'
import type { Factor, ReasonKind } from './types'

export interface TeamMember {
  champion: number
  /** 1 = confirmado, <1 = seleção temporária. */
  weight: number
  traits: ChampionTraits
}

export interface CompositionResult {
  factors: Factor[]
  /** Soma saturada (pp). */
  totalPp: number
  /** 0–1: quanto do time aliado já é conhecido. */
  knowledge: number
}

interface Axis {
  kind: ReasonKind
  raw: number
  text: string
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

/**
 * Heurísticas de composição: medem NECESSIDADES do time (déficits) e o quanto o candidato as
 * supre. Não usam estatísticas, para não contar o mesmo sinal duas vezes. As contribuições
 * são somadas e SATURADAS (tanh) para que eixos correlacionados (ex.: tanque = frontline +
 * engage + CC) não se acumulem além de `caps.compositionPp`.
 */
export function evaluateComposition(
  allies: TeamMember[],
  enemies: TeamMember[],
  c: ChampionTraits
): CompositionResult {
  const A = CONFIG.compositionAxisPp
  const T = CONFIG.compositionTargets
  const W = sum(allies.map((a) => a.weight))
  const knowledge = clamp(W / CONFIG.compositionFullInfoAllies, 0, 1)
  const axes: Axis[] = []

  if (W > 0) {
    // 1) Equilíbrio de dano
    const mass = sum(allies.map((a) => a.weight * a.traits.damageWeight))
    if (mass >= 1) {
      const phys = sum(allies.map((a) => a.weight * a.traits.damageWeight * a.traits.ad)) / mass
      const dWantAp = clamp((phys - 0.6) / 0.3, 0, 1)
      const dWantAd = clamp((0.4 - phys) / 0.3, 0, 1)
      const dir = dWantAp - dWantAd // >0: time precisa de dano mágico
      const fit = (c.ap - c.ad) * c.damageWeight
      const raw = A.damage * dir * fit
      if (Math.abs(raw) > 0.02) {
        const physPct = fmtPct0(phys)
        const magPct = fmtPct0(1 - phys)
        let text: string
        if (raw > 0) {
          text =
            dir > 0
              ? `Seu time tem ${physPct} de dano físico; este campeão traz dano mágico.`
              : `Seu time tem ${magPct} de dano mágico; este campeão traz dano físico.`
        } else {
          text =
            dir > 0
              ? `Seu time já tem ${physPct} de dano físico e este campeão acrescenta mais dano físico.`
              : `Seu time já tem ${magPct} de dano mágico e este campeão acrescenta mais dano mágico.`
        }
        axes.push({ kind: 'damage', raw, text })
      }
    }

    // 2) Linha de frente
    const front = sum(allies.map((a) => a.weight * a.traits.frontline))
    const frontDeficit = clamp((T.frontline - front) / T.frontline, 0, 1)
    const frontSurplus = clamp((front - 2) / 1.5, 0, 1)
    const rawFront = A.frontline * (frontDeficit * c.frontline - 0.6 * frontSurplus * c.frontline)
    if (Math.abs(rawFront) > 0.02) {
      axes.push({
        kind: 'frontline',
        raw: rawFront,
        text:
          rawFront > 0
            ? front < 0.5
              ? 'Seu time ainda não tem linha de frente; este campeão é resistente.'
              : 'Seu time tem pouca linha de frente; este campeão reforça a resistência.'
            : 'Seu time já tem linha de frente de sobra; mais resistência custa dano.'
      })
    }

    // 3) Engajamento
    const engage = sum(allies.map((a) => a.weight * a.traits.engage))
    const rawEngage = A.engage * clamp(1 - engage / T.engage, 0, 1) * c.engage
    if (rawEngage > 0.02) {
      axes.push({
        kind: 'engage',
        raw: rawEngage,
        text:
          engage < 0.3
            ? 'Seu time não tem engajamento claro; este campeão inicia lutas.'
            : 'Seu time tem pouco engajamento; este campeão ajuda a iniciar lutas.'
      })
    }

    // 4) Controle de grupo
    const cc = sum(allies.map((a) => a.weight * a.traits.cc))
    const rawCc = A.cc * clamp((T.cc - cc) / T.cc, 0, 1) * c.cc
    if (rawCc > 0.02) {
      axes.push({ kind: 'cc', raw: rawCc, text: 'Pouco controle de grupo no seu time; este campeão traz CC.' })
    }

    // 5) Proteção (peel) para quem precisa dela
    const hyper = clamp(sum(allies.map((a) => a.weight * (a.traits.hypercarry ? 1 : 0))), 0, 1)
    const peel = sum(allies.map((a) => a.weight * a.traits.peel))
    const peelDeficit = hyper * clamp(1 - peel / T.peel, 0, 1)
    let rawPeel = A.peel * peelDeficit * c.peel
    let peelText = 'Seu time tem um carregador de fim de jogo e pouca proteção; este campeão protege aliados.'
    if (c.hypercarry && peel < 0.5 && W >= 3) {
      rawPeel -= A.peel * 0.6
      peelText = 'Este campeão depende de proteção e seu time tem pouca.'
    }
    if (Math.abs(rawPeel) > 0.02) axes.push({ kind: 'peel', raw: rawPeel, text: peelText })

    // 6) Desengajar contra mergulhadores inimigos
    if (enemies.length > 0) {
      const dive = sum(enemies.map((e) => e.weight * e.traits.dive))
      const guard = sum(allies.map((a) => a.weight * Math.max(a.traits.disengage, a.traits.peel * 0.6)))
      const need = clamp((dive - 1.5) / 1.5, 0, 1) * clamp(1 - guard / T.disengage, 0, 1)
      const rawDis = A.disengage * need * Math.max(c.disengage, c.peel * 0.6)
      if (rawDis > 0.02) {
        axes.push({
          kind: 'disengage',
          raw: rawDis,
          text: 'Os inimigos têm vários mergulhadores; este campeão ajuda a proteger e desengajar.'
        })
      }
    }

    // 7) Alcance
    if (W >= 3) {
      const melee = sum(allies.map((a) => a.weight * (a.traits.ranged ? 0 : 1))) / W
      const deficit = clamp((melee - 0.6) / 0.4, 0, 1)
      const rawRange = A.range * deficit * (c.ranged ? 1 : -0.5)
      if (Math.abs(rawRange) > 0.02) {
        axes.push({
          kind: 'range',
          raw: rawRange,
          text:
            rawRange > 0
              ? 'Seu time é quase todo corpo a corpo; este campeão ataca à distância.'
              : 'Seu time é quase todo corpo a corpo e este campeão também precisa chegar perto.'
        })
      }
    }
  }

  const rawTotal = sum(axes.map((a) => a.raw)) * knowledge
  const cap = CONFIG.caps.compositionPp
  const totalPp = cap * Math.tanh(rawTotal / cap)
  const scale = rawTotal !== 0 ? totalPp / rawTotal : 0

  const factors: Factor[] = axes
    .map((a) => ({
      kind: a.kind,
      group: 'composicao' as const,
      pp: a.raw * knowledge * scale,
      text: a.text
    }))
    .filter((f) => Math.abs(f.pp) >= 0.05)

  return { factors, totalPp, knowledge }
}
