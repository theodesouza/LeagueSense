import type { ReactElement, SVGProps } from 'react'
import {
  ChartColumn,
  ChevronsRight,
  Crosshair,
  Flame,
  HeartHandshake,
  Shield,
  Snowflake,
  Star,
  Swords,
  Undo2,
  Users
} from 'lucide-react'
import type { Position, ReasonKind } from '@core/types'

type P = SVGProps<SVGSVGElement> & { size?: number }

/** Ícones de rota: mini-mapa com a rota destacada (traço consistente com a família Lucide). */
export function PositionIcon({ position, size = 18, ...rest }: P & { position: Position | null }): ReactElement {
  const hi = 'var(--accent)'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" opacity={0.4} />
      <path d="M5 19 19 5" opacity={0.4} />
      {position === 'top' && <path d="M5 19V5h14" stroke={hi} strokeWidth={2.2} />}
      {position === 'mid' && <path d="M5 19 19 5" stroke={hi} strokeWidth={2.2} />}
      {(position === 'adc' || position === 'support') && <path d="M5 19h14V5" stroke={hi} strokeWidth={2.2} />}
      {position === 'jungle' && (
        <>
          <circle cx="8.3" cy="14" r="1.9" fill={hi} stroke="none" />
          <circle cx="15.7" cy="10" r="1.9" fill={hi} stroke="none" />
        </>
      )}
      {position === 'adc' && <circle cx="17" cy="17" r="1.8" fill={hi} stroke="none" />}
      {position === 'support' && <circle cx="17" cy="17" r="2" stroke={hi} strokeWidth={1.6} />}
      {position === null && <path d="M10 10.2a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6M12 16.4h.01" strokeWidth={1.8} />}
    </svg>
  )
}

const KIND: Record<ReasonKind, (p: { size: number }) => ReactElement> = {
  base: ({ size }) => <ChartColumn size={size} />,
  matchup: ({ size }) => <Swords size={size} />,
  synergy: ({ size }) => <Users size={size} />,
  damage: ({ size }) => <Flame size={size} />,
  frontline: ({ size }) => <Shield size={size} />,
  engage: ({ size }) => <ChevronsRight size={size} />,
  cc: ({ size }) => <Snowflake size={size} />,
  peel: ({ size }) => <HeartHandshake size={size} />,
  disengage: ({ size }) => <Undo2 size={size} />,
  range: ({ size }) => <Crosshair size={size} />,
  familiarity: ({ size }) => <Star size={size} />
}

export function KindIcon({ kind, size = 15 }: { kind: ReasonKind; size?: number }): ReactElement {
  const C = KIND[kind]
  return (
    <span className="kind-icon" data-kind={kind} aria-hidden="true">
      <C size={size} />
    </span>
  )
}

export function Logo({ size = 22 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5 20.2 7.2v9.6L12 21.5 3.8 16.8V7.2L12 2.5Z" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 8.2 15.4 10.2v3.6L12 15.8l-3.4-2v-3.6L12 8.2Z" fill="var(--accent)" />
    </svg>
  )
}
