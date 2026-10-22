import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { DEFAULT_PREFERENCES, ELO_TIERS, POSITIONS, type Preferences } from '@core/types'

const familiarity = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

/** Cada campo tem fallback próprio: arquivo antigo, editado à mão ou corrompido nunca derruba o app. */
export const PreferencesSchema = z.object({
  position: z.enum(POSITIONS).nullable().catch(DEFAULT_PREFERENCES.position),
  elo: z.enum(ELO_TIERS).catch(DEFAULT_PREFERENCES.elo),
  region: z.string().max(12).catch(DEFAULT_PREFERENCES.region),
  pool: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((r) => {
      const out: Record<number, 1 | 2 | 3 | 4> = {}
      for (const [k, v] of Object.entries(r)) {
        const id = Number(k)
        const f = familiarity.safeParse(v)
        if (Number.isInteger(id) && id > 0 && f.success) out[id] = f.data
      }
      return out
    }),
  restrictToPool: z.boolean().catch(DEFAULT_PREFERENCES.restrictToPool),
  excluded: z
    .array(z.unknown())
    .catch([])
    .transform((a) => [...new Set(a.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0))]),
  hideUnowned: z.boolean().catch(DEFAULT_PREFERENCES.hideUnowned),
  familiarityWeight: z.union([z.literal(0.5), z.literal(1), z.literal(1.5)]).catch(DEFAULT_PREFERENCES.familiarityWeight),
  motion: z.enum(['system', 'reduced', 'full']).catch(DEFAULT_PREFERENCES.motion),
  sendBuild: z
    .object({
      items: z.boolean().catch(DEFAULT_PREFERENCES.sendBuild.items),
      runes: z.boolean().catch(DEFAULT_PREFERENCES.sendBuild.runes),
      spells: z.boolean().catch(DEFAULT_PREFERENCES.sendBuild.spells)
    })
    .catch({ ...DEFAULT_PREFERENCES.sendBuild })
})

export function parsePreferences(raw: unknown): Preferences {
  const r = PreferencesSchema.safeParse(raw && typeof raw === 'object' ? raw : {})
  return r.success ? (r.data as Preferences) : { ...DEFAULT_PREFERENCES }
}

type Listener = (p: Preferences) => void

/** Preferências locais em JSON (userData), com escrita atômica e adiada. */
export class SettingsStore {
  private prefs: Preferences = { ...DEFAULT_PREFERENCES }
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly debounceMs = 250
  ) {}

  async load(): Promise<Preferences> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { version?: number; prefs?: unknown }
      this.prefs = parsePreferences(raw?.prefs)
    } catch {
      this.prefs = { ...DEFAULT_PREFERENCES }
    }
    return this.prefs
  }

  get(): Preferences {
    return this.prefs
  }

  set(patch: Partial<Preferences>): Preferences {
    this.prefs = parsePreferences({ ...this.prefs, ...patch })
    for (const l of this.listeners) l(this.prefs)
    this.schedule()
    return this.prefs
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.debounceMs)
  }

  /** Grava imediatamente (usado ao sair do app). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const snapshot = JSON.stringify({ version: 1, prefs: this.prefs }, null, 2)
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true })
        const tmp = `${this.file}.${process.pid}.tmp`
        await writeFile(tmp, snapshot, 'utf8')
        await rename(tmp, this.file)
      } catch {
        /* sem permissão de escrita: as preferências valem só nesta sessão */
      }
    })
    await this.writing
  }
}
