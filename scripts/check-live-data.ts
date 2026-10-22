/**
 * Verificação AO VIVO (rede): todo campeão do roster embutido resolve no OP.GG?
 *  - casa nomes das listas por rota com o roster;
 *  - chama a análise de cada campeão em sua rota típica (valida o formato do parâmetro `champion`).
 * Uso: npm run check:data
 */
import rosterJson from '../src/core/data/roster.json'
import traitsJson from '../src/core/data/traits.json'
import type { TraitsTable } from '../src/core/traits'
import { McpClient } from '../src/main/sources/opgg/mcp'
import { OpggProvider, normalizeName } from '../src/main/sources/opgg/provider'

const roster = rosterJson as unknown as { ddragonVersion: string; champions: { id: number; key: string; name: string; nameEn: string }[] }
const traits = (traitsJson as unknown as { traits: TraitsTable }).traits

async function main(): Promise<void> {
  const p = new OpggProvider(new McpClient({ concurrency: 3 }))
  const meta = await p.laneMeta()
  const inMeta = new Set<number>()
  for (const t of Object.values(meta.byPosition)) for (const id of Object.keys(t ?? {})) inMeta.add(Number(id))
  const notInMeta = roster.champions.filter((c) => !inMeta.has(c.id))
  console.log(`Listas por rota: ${inMeta.size} campeões casados; nomes sem correspondência no roster: ${[...p.unmatched].join(', ') || 'nenhum'}`)
  console.log(`Campeões do roster ausentes nas listas (sem estatística nesta janela): ${notInMeta.map((c) => c.name).join(', ') || 'nenhum'}`)

  const failures: string[] = []
  let ok = 0
  const queue = roster.champions.filter((c) => inMeta.has(c.id))
  const worker = async (): Promise<void> => {
    for (;;) {
      const c = queue.shift()
      if (!c) return
      const pos = (Object.entries(meta.roleRates[c.id] ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? traits[c.id]?.positions[0] ?? 'mid') as 'top'
      try {
        await p.baseAtTier(c.id, pos, 'EMERALD_PLUS')
        ok++
      } catch (e) {
        failures.push(`${c.key} (${pos}): ${(e as Error).message}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  console.log(`Análise por campeão: ${ok} ok, ${failures.length} falhas`)
  for (const f of failures) console.log('  ✘', f)
  void normalizeName
  process.exit(failures.length ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(2)
})
