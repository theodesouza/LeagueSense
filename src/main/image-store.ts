import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { httpRequest } from './http'

export type ImageKind = 'square' | 'splash' | 'loading' | 'item' | 'spell' | 'rune'

const DD = 'https://ddragon.leagueoflegends.com/cdn'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg' }

export interface ImageResult {
  data: Buffer
  mime: string
}

/**
 * Imagens de campeões do Data Dragon (única fonte de imagens permitida pela política da Riot),
 * baixadas sob demanda e guardadas em disco. Nada é embutido no instalador.
 */
export class ImageStore {
  private readonly pending = new Map<string, Promise<ImageResult | null>>()
  constructor(
    private readonly dir: string,
    private readonly opts: { fetchImpl?: typeof fetch } = {}
  ) {}

  static validKey(key: string, kind: ImageKind = 'square'): boolean {
    if (kind === 'item') return /^\d{1,6}$/.test(key)
    if (kind === 'rune') return ImageStore.runePath(key) != null
    return /^[A-Za-z0-9]{1,32}$/.test(key)
  }

  /** Runas: a chave é o caminho do ícone em base64url (ex.: perk-images/Styles/...). */
  static runePath(key: string): string | null {
    if (!/^[A-Za-z0-9_-]{1,250}$/.test(key)) return null
    try {
      const p = Buffer.from(key, 'base64url').toString('utf8')
      return /^perk-images\/[A-Za-z0-9_\-\/]{1,200}\.(png|jpg)$/.test(p) && !p.includes('..') ? p : null
    } catch {
      return null
    }
  }

  private url(kind: ImageKind, key: string, version: string): { url: string; ext: 'png' | 'jpg' } {
    if (kind === 'square') return { url: `${DD}/${version}/img/champion/${key}.png`, ext: 'png' }
    if (kind === 'item') return { url: `${DD}/${version}/img/item/${key}.png`, ext: 'png' }
    if (kind === 'spell') return { url: `${DD}/${version}/img/spell/${key}.png`, ext: 'png' }
    if (kind === 'rune') return { url: `${DD}/img/${ImageStore.runePath(key)}`, ext: 'png' }
    if (kind === 'splash') return { url: `${DD}/img/champion/splash/${key}_0.jpg`, ext: 'jpg' }
    return { url: `${DD}/img/champion/loading/${key}_0.jpg`, ext: 'jpg' }
  }

  async get(kind: ImageKind, key: string, version: string): Promise<ImageResult | null> {
    if (!ImageStore.validKey(key, kind) || !/^\d+\.\d+\.\d+$/.test(version)) return null
    const { url, ext } = this.url(kind, key, version)
    // splash/loading não dependem da versão do patch; o ícone sim
    const versioned = kind === 'square' || kind === 'item' || kind === 'spell'
    const folder = versioned ? join(this.dir, version, kind) : join(this.dir, kind)
    const file = join(folder, `${key}.${ext}`) // chaves validadas: dígitos, letras ou base64url
    try {
      return { data: await readFile(file), mime: MIME[ext]! }
    } catch {
      /* não está em disco */
    }
    const k = `${kind}:${key}:${versioned ? version : ''}`
    const existing = this.pending.get(k)
    if (existing) return existing
    const p = (async (): Promise<ImageResult | null> => {
      try {
        const res = await httpRequest('ddragon', url, { timeoutMs: 15_000, retries: 1, ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}) })
        const data = Buffer.from(await res.arrayBuffer())
        if (data.length < 100) return null
        await mkdir(folder, { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, data)
        await rename(tmp, file)
        return { data, mime: MIME[ext]! }
      } catch {
        return null
      } finally {
        this.pending.delete(k)
      }
    })()
    this.pending.set(k, p)
    return p
  }
}
