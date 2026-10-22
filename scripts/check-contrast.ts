/** Calcula razões de contraste WCAG 2.1 para os pares de cor usados como texto/controle. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../src/renderer/styles/tokens.css'), 'utf8')
const tok: Record<string, string> = {}
for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tok[m[1]!] = m[2]!

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const pairs: [string, string, number][] = []
for (const fg of ['text-1', 'text-2', 'text-3', 'accent', 'enemy', 'warn', 'danger']) {
  for (const bg of ['bg-0', 'bg-1', 'bg-2', 'bg-3']) pairs.push([fg, bg, 4.5])
}
pairs.push(['on-accent', 'accent', 4.5])
pairs.push(['line-3', 'bg-2', 3]) // borda de controles interativos (não-texto)

let bad = 0
for (const [fg, bg, min] of pairs) {
  const r = ratio(tok[fg]!, tok[bg]!)
  const ok = r >= min
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${fg.padEnd(10)} sobre ${bg.padEnd(5)} ${r.toFixed(2)}:1 (mín. ${min})`)
}
console.log(bad === 0 ? '\nTodos os pares atendem.' : `\n${bad} par(es) abaixo do mínimo.`)
process.exit(bad === 0 ? 0 : 1)
