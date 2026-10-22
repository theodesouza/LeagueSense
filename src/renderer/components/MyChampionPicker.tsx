import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { unavailableChampions } from '@core/draft'
import type { TraitsTable } from '@core/traits'
import type { Draft } from '@core/types'
import { ChampionGrid } from './ChampionGrid'
import { useApp } from '../state/store'

/**
 * Escolha do MEU campeão pelo app (independente de o cliente ter travado algo).
 * Só abre por ação do usuário. Campeões banidos ou já escolhidos ficam desabilitados.
 */
export function MyChampionPicker({ anchor, draft, traits, current, onClose }: { anchor: HTMLElement; draft: Draft; traits: TraitsTable; current: number | null; onClose: () => void }): ReactElement {
  const { champions, version, dispatch } = useApp()
  const box = useRef<HTMLDivElement | null>(null)
  const search = useRef<HTMLInputElement | null>(null)
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect()
    const w = 372
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8)
    const below = window.innerHeight - r.bottom
    const top = below >= 360 || below > r.top ? r.bottom + 8 : Math.max(8, r.top - 8 - 440)
    return { left, top, maxH: Math.min(480, window.innerHeight - top - 8) }
  })
  const off = unavailableChampions(draft)

  const closeAndRestore = (): void => {
    onClose()
    requestAnimationFrame(() => anchor.focus())
  }

  useEffect(() => {
    search.current?.focus()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        requestAnimationFrame(() => anchor.focus())
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <div ref={box} className="popover" role="dialog" aria-label="Escolher o meu campeão" style={{ left: pos.left, top: pos.top, maxHeight: pos.maxH }}>
      <header className="pop-head">
        <h3>Escolher o meu campeão</h3>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={closeAndRestore}>
          <X size={16} />
        </button>
      </header>
      <ChampionGrid
        champions={champions}
        version={version}
        traits={traits}
        disabled={off}
        disabledLabel="banido ou já escolhido"
        currentId={current}
        searchRef={search}
        onChoose={(id) => {
          dispatch({ type: 'myPick', champion: id, toPlan: true })
          requestAnimationFrame(() => anchor.focus())
        }}
      />
      <footer className="pop-foot">
        <p className="muted small">Isto só escolhe o campeão <strong>no LeagueSense</strong> (para ver o plano de jogo). Não seleciona nem trava nada no cliente do jogo.</p>
      </footer>
    </div>,
    document.body
  )
}
