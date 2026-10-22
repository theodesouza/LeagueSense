import { useEffect, useRef, useState, type ReactElement } from 'react'

const reduced = (): boolean => {
  const m = document.documentElement.dataset['motion']
  return m === 'reduced' || (m !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

/** Anima o número com transição curta (sem bloquear nada); respeita movimento reduzido. */
export function useCountTo(value: number, ms = 220): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduced() || Math.abs(value - from.current) < 0.5) {
      setShown(value)
      from.current = value
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number): void => {
      const p = Math.min(1, (t - start) / ms)
      const e = 1 - (1 - p) ** 3
      const v = a + (value - a) * e
      setShown(v)
      from.current = v
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

export function ScoreMeter({ value, size = 'lg' }: { value: number; size?: 'lg' | 'sm' }): ReactElement {
  const shown = useCountTo(value)
  const v = Math.round(value)
  return (
    <div className="meter" data-size={size} role="img" aria-label={`Adequação ${v} de 100 (relativa, não é chance de vitória)`}>
      <span className="meter-num" aria-hidden="true">{Math.round(shown)}</span>
      <span className="meter-side" aria-hidden="true">
        {size === 'lg' && <span className="meter-label">Adequação <em>/100</em></span>}
        <span className="meter-bar"><i style={{ transform: `scaleX(${Math.min(1, Math.max(0, value / 100))})` }} /></span>
      </span>
    </div>
  )
}
