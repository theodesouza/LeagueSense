import type { ReactElement } from 'react'
import type { ItemInfo, RuneInfo, SpellInfo, StyleInfo } from '@core/build-types'
import { itemImage, runeImage, spellImage } from '../api'
import { useImageState } from './Portrait'

type Shape = 'square' | 'round'

function GameImage({ src, label, size, shape = 'square', mono }: { src: string | null; label: string; size: number; shape?: Shape; mono: string }): ReactElement {
  const { state, onLoad, onError } = useImageState(src)
  return (
    <span className="gimg" data-state={state} data-shape={shape} style={{ width: size, height: size }}>
      {src && state !== 'error' && <img src={src} alt={label} draggable={false} decoding="async" onLoad={onLoad} onError={onError} />}
      {(state === 'error' || !src) && <span className="gimg-mono" role="img" aria-label={label}>{mono}</span>}
    </span>
  )
}

const mono = (s: string): string => s.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?'

export function ItemIcon({ id, name, version, size = 40 }: { id: number; name: string; version: string; size?: number }): ReactElement {
  return <GameImage src={itemImage(id, version)} label={name} size={size} mono={mono(name)} />
}

export function SpellIcon({ spell, fallbackId, version, size = 32 }: { spell: SpellInfo | undefined; fallbackId: number; version: string; size?: number }): ReactElement {
  const name = spell?.name ?? `Feitiço ${fallbackId}`
  return <GameImage src={spell ? spellImage(spell.key, version) : null} label={name} size={size} mono={mono(name)} />
}

export function RuneIcon({ rune, style, fallbackName, version, size = 28 }: { rune?: RuneInfo | undefined; style?: StyleInfo | undefined; fallbackName: string; version: string; size?: number }): ReactElement {
  const path = rune?.icon ?? style?.icon ?? null
  const name = rune?.name ?? style?.name ?? fallbackName
  return <GameImage src={path ? runeImage(path, version) : null} label={name} size={size} shape="round" mono={mono(name)} />
}

export function ShardIcon({ icon, name, version, size = 24 }: { icon: string; name: string; version: string; size?: number }): ReactElement {
  return <GameImage src={runeImage(icon, version)} label={name} size={size} shape="round" mono={mono(name)} />
}

export type { ItemInfo }
