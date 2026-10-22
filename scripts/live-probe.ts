import { McpClient } from '../src/main/sources/opgg/mcp'
import { OpggProvider } from '../src/main/sources/opgg/provider'

async function main(): Promise<void> {
  const p = new OpggProvider(new McpClient())
  let t = Date.now()
  const meta = await p.laneMeta()
  console.log('laneMeta', Object.entries(meta.byPosition).map(([k, v]) => `${k}:${Object.keys(v!).length}`).join(' '), `${Date.now() - t}ms`, 'unmatched:', [...p.unmatched])
  t = Date.now()
  console.log('patch', await p.patch({ champion: 103, position: 'mid' }), `${Date.now() - t}ms`)
  t = Date.now()
  console.log('base', await p.baseAtTier(103, 'mid', 'GOLD'), `${Date.now() - t}ms`)
  t = Date.now()
  const m = await p.matchups(103, 'mid')
  console.log('matchups', Object.keys(m.entries).length, m.patch, `${Date.now() - t}ms`, m.entries[157])
  t = Date.now()
  const s = await p.synergies(103, 'mid', 'support')
  console.log('synergies', Object.keys(s.entries).length, `${Date.now() - t}ms`, s.entries[412])
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
