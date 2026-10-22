import type { TeamMember } from './composition'

export interface TeamProfile {
  /** Soma dos pesos dos membros (confirmados = 1, temporários = 0,5). */
  weight: number
  /** Fração de dano físico ponderada pelo peso de dano; `null` sem massa de dano suficiente. */
  physical: number | null
  dmgMass: number
  frontline: number
  engage: number
  cc: number
  peel: number
  dive: number
  sustain: number
  hypercarries: number
  /** Campeões que mais contribuem em cada eixo (para citar nomes), do maior para o menor. */
  top: {
    dive: number[]
    sustain: number[]
    tanks: number[]
    engage: number[]
    hypercarry: number[]
    physical: number[]
    magic: number[]
    cc: number[]
  }
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

function ranked(members: TeamMember[], score: (m: TeamMember) => number, min: number): number[] {
  return members
    .map((m) => ({ id: m.champion, v: score(m) }))
    .filter((x) => x.v >= min)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.id)
}

/** Resume uma equipe (aliada ou inimiga) nos eixos usados por builds e plano de jogo. */
export function profileTeam(members: TeamMember[]): TeamProfile {
  const w = (m: TeamMember): number => m.weight
  const mass = sum(members.map((m) => w(m) * m.traits.damageWeight))
  const phys = sum(members.map((m) => w(m) * m.traits.damageWeight * m.traits.ad))
  return {
    weight: sum(members.map(w)),
    physical: mass >= 1 ? phys / mass : null,
    dmgMass: mass,
    frontline: sum(members.map((m) => w(m) * m.traits.frontline)),
    engage: sum(members.map((m) => w(m) * m.traits.engage)),
    cc: sum(members.map((m) => w(m) * m.traits.cc)),
    peel: sum(members.map((m) => w(m) * m.traits.peel)),
    dive: sum(members.map((m) => w(m) * m.traits.dive)),
    sustain: sum(members.map((m) => w(m) * m.traits.sustain)),
    hypercarries: sum(members.map((m) => w(m) * (m.traits.hypercarry ? 1 : 0))),
    top: {
      dive: ranked(members, (m) => m.traits.dive, 0.6),
      sustain: ranked(members, (m) => m.traits.sustain, 0.4),
      tanks: ranked(members, (m) => m.traits.frontline, 0.6),
      engage: ranked(members, (m) => m.traits.engage, 0.6),
      hypercarry: ranked(members, (m) => (m.traits.hypercarry ? 1 : 0), 1),
      physical: ranked(members, (m) => m.traits.damageWeight * m.traits.ad, 0.4),
      magic: ranked(members, (m) => m.traits.damageWeight * m.traits.ap, 0.4),
      cc: ranked(members, (m) => m.traits.cc, 0.5)
    }
  }
}
