import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import type { ChampionInfo } from '@core/types'
import { championImage } from '../api'

interface Props {
  champion: ChampionInfo | undefined
  version: string
  size: number
  kind?: 'square' | 'splash' | 'loading'
  className?: string
  /** Texto alternativo; vazio quando o nome já aparece ao lado. */
  alt?: string
  style?: CSSProperties
}

/** Retrato de campeão: imagem do Data Dragon com recuo para monograma (nunca imagem quebrada). */
export function Portrait({ champion, version, size, kind = 'square', className = '', alt = '', style }: Props): ReactElement {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const key = champion?.key
  useEffect(() => setState('loading'), [key, version])
  const mono = (champion?.name ?? '?').slice(0, 2)
  const src = key ? championImage(kind, key, version) : null
  return (
    <span className={`portrait ${className}`} data-state={state} style={{ width: size, height: size, ...style }}>
      {src && state !== 'error' && (
        <img src={src} alt={alt} draggable={false} decoding="async" onLoad={() => setState('ok')} onError={() => setState('error')} />
      )}
      {(state === 'error' || !src) && <span className="portrait-mono" aria-hidden="true">{mono}</span>}
    </span>
  )
}

/** Arte larga (splash) para o destaque; recorte por CSS, fade lateral e recuo gracioso. */
export function SplashArt({ champion, version }: { champion: ChampionInfo | undefined; version: string }): ReactElement {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const key = champion?.key
  useEffect(() => setState('loading'), [key])
  const src = key ? championImage('splash', key, version) : null
  return (
    <span className="splash" data-state={state} aria-hidden="true">
      {src && state !== 'error' && <img src={src} alt="" draggable={false} decoding="async" onLoad={() => setState('ok')} onError={() => setState('error')} />}
      {(state === 'error' || !src) && <span className="splash-mono">{(champion?.name ?? '?').slice(0, 1)}</span>}
    </span>
  )
}
