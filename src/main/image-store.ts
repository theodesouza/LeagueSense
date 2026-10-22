import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { httpRequest } from './http'

export type ImageKind = 'square' | 'splash' | 'loading'

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

  static validKey(key: string): boolean {
    return /^[A-Za-z0-9]{1,32}$/.test(key)
  }

  private url(kind: ImageKind, key: string, version: string): { url: string; ext: 'png' | 'jpg' } {
    if (kind === 'square') return { url: `${DD}/${version}/img/champion/${key}.png`, ext: 'png' }
    if (kind === 'splash') return { url: `${DD}/img/champion/splash/${key}_0.jpg`, ext: 'jpg' }
    return { url: `${DD}/img/champion/loading/${key}_0.jpg`, ext: 'jpg' }
  }

  async get(kind: ImageKind, key: string, version: string): Promise<ImageResult | null> {
    if (!ImageStore.validKey(key) || !/^\d+\.\d+\.\d+$/.test(version)) return null
    const { url, ext } = this.url(kind, key, version)
    // splash/loading não dependem da versão do patch; o ícone sim
    const folder = kind === 'square' ? join(this.dir, version, kind) : join(this.dir, kind)
    const file = join(folder, `${key}.${ext}`)
    try {
      return { data: await readFile(file), mime: MIME[ext]! }
    } catch {
      /* não está em disco */
    }
    const k = `${kind}:${key}:${kind === 'square' ? version : ''}`
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
