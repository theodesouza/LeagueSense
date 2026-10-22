import { useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from 'react'
import { Search } from 'lucide-react'
import type { TraitsTable } from '@core/traits'
import { POSITIONS, POSITION_LABEL, type ChampionInfo, type Position } from '@core/types'
import { PositionIcon } from './icons'
import { Portrait } from './Portrait'

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Props {
  champions: ReadonlyMap<number, ChampionInfo>
  version: string
  traits: TraitsTable
  /** Campeões que não podem ser escolhidos agora (rótulo mostra o motivo). */
  disabled?: ReadonlySet<number>
  disabledLabel?: string
  currentId?: number | null
  /** Filtro de posição inicial. */
  initialRole?: Position | 'all'
  searchRef?: RefObject<HTMLInputElement | null>
  onChoose: (id: number) => void
}

/** Busca + filtro por posição + grade de campeões, com navegação por setas. Usado no draft manual e na escolha do meu campeão. */
export function ChampionGrid({ champions, version, traits, disabled, disabledLabel = 'indisponível', currentId, initialRole = 'all', searchRef, onChoose }: Props): ReactElement {
  const own = useRef<HTMLInputElement | null>(null)
  const search = searchRef ?? own
  const root = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Position | 'all'>(initialRole)

  const list = useMemo(() => {
    const q = norm(query.trim())
    return [...champions.values()]
      .filter((c) => (q ? norm(c.name).includes(q) || norm(c.nameEn).includes(q) : true))
      .filter((c) => (role === 'all' ? true : traits[c.id]?.positions.includes(role) ?? true))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [champions, query, role, traits])

  const isOff = (id: number): boolean => !!disabled?.has(id) && id !== currentId

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button.tile:not(:disabled)')]
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const cols = Math.max(1, Math.floor(e.currentTarget.clientWidth / 64))
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key]
    if (move == null) return
    e.preventDefault()
    const next = tiles[i + move]
    if (next) next.focus()
    else if (move < 0) search.current?.focus()
  }

  return (
    <div ref={root} className="champ-grid">
      <label className="search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={search}
          type="search"
          placeholder="Buscar campeão…"
          aria-label="Buscar campeão"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              root.current?.querySelector<HTMLButtonElement>('button.tile:not(:disabled)')?.focus()
            }
            if (e.key === 'Enter' && list.length > 0) {
              const first = list.find((c) => !isOff(c.id))
              if (first) onChoose(first.id)
            }
          }}
        />
      </label>
      <div className="chips" role="radiogroup" aria-label="Filtrar por posição">
        {(['all', ...POSITIONS] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={role === p} className="chip" data-on={role === p || undefined} onClick={() => setRole(p)}>
            {p === 'all' ? 'Todos' : (<><PositionIcon position={p} size={13} />{POSITION_LABEL[p]}</>)}
          </button>
        ))}
      </div>
      <div className="tiles" role="group" aria-label="Campeões" onKeyDown={onGridKey}>
        {list.map((c) => {
          const off = isOff(c.id)
          return (
            <button key={c.id} type="button" className="tile" disabled={off} data-current={c.id === currentId || undefined} aria-label={off ? `${c.name} (${disabledLabel})` : c.name} title={off ? disabledLabel : c.name} onClick={() => onChoose(c.id)}>
              <Portrait champion={c} version={version} size={44} />
              <span>{c.name}</span>
            </button>
          )
        })}
        {list.length === 0 && <p className="muted pad">Nenhum campeão encontrado.</p>}
      </div>
    </div>
  )
}
