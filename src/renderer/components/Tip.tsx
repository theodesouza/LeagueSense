import { cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  text: string
  children: ReactElement<{ 'aria-describedby'?: string }>
  side?: 'top' | 'bottom'
}

/**
 * Tooltip que COMPLEMENTA (a informação essencial continua visível/rotulada no elemento).
 * Aparece com atraso ao passar o mouse ou focar; Esc fecha; não captura cliques.
 */
export function Tip({ text, children, side = 'bottom' }: Props): ReactElement {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; flip: boolean } | null>(null)
  const ref = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const flip = side === 'top' ? r.top < 56 : r.bottom > window.innerHeight - 64
      const below = side === 'bottom' ? !flip : flip
      setPos({ x: Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120), y: below ? r.bottom + 8 : r.top - 8, flip: !below })
      setOpen(true)
    }, 380)
  }, [side])
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [open, hide])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const child = cloneElement(children, {
    ref: (el: HTMLElement | null) => (ref.current = el),
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    'aria-describedby': open ? id : undefined
  } as never)

  return (
    <>
      {child}
      {open &&
        pos &&
        createPortal(
          <div role="tooltip" id={id} className="tip" data-flip={pos.flip} style={{ left: pos.x, top: pos.y }}>
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
