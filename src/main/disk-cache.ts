import { mkdir, readFile, rename, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { CacheEntry, CacheStore } from './cache'

const safe = (key: string): string => key.replace(/[^a-zA-Z0-9._-]/g, '_')

/** Cache JSON em disco (um arquivo por chave), com escrita atômica. Falhas de E/S nunca derrubam o app. */
export class DiskCache implements CacheStore {
  private ready: Promise<void> | null = null
  constructor(private readonly dir: string) {}

  private ensure(): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined)
    return this.ready
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const raw = await readFile(join(this.dir, `${safe(key)}.json`), 'utf8')
      const parsed = JSON.parse(raw) as CacheEntry<T>
      if (typeof parsed?.fetchedAt !== 'number' || !('value' in parsed)) return null
      return parsed
    } catch {
      return null
    }
  }

  async set<T>(key: string, value: T, fetchedAt: number): Promise<void> {
    try {
      await this.ensure()
      const file = join(this.dir, `${safe(key)}.json`)
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify({ value, fetchedAt }), 'utf8')
      await rename(tmp, file)
    } catch {
      /* cache é otimização: ignorar */
    }
  }

  async clear(prefix = ''): Promise<void> {
    try {
      const files = await readdir(this.dir)
      await Promise.all(files.filter((f) => f.startsWith(safe(prefix))).map((f) => rm(join(this.dir, f), { force: true })))
    } catch {
      /* diretório ainda não existe */
    }
  }
}

