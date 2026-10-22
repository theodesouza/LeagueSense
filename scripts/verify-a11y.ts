/**
 * Auditoria automática de acessibilidade (axe-core) em estados-chave, no navegador com o simulador.
 * Cobre regras WCAG A/AA detectáveis por máquina (contraste, nomes acessíveis, ARIA, etc.). Não substitui
 * teste manual com leitor de tela.   (com `npm run dev:web` ativo)  npx tsx scripts/verify-a11y.ts
 */
import AxeBuilder from '@axe-core/playwright'
import { chromium, type Page } from 'playwright'

const URL = process.env['LS_URL'] ?? 'http://127.0.0.1:5173/'
let total = 0

async function audit(p: Page, name: string): Promise<void> {
  const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  total += r.violations.length
  console.log(`${r.violations.length === 0 ? '✔' : '✘'} ${name}: ${r.violations.length} violações (${r.passes.length} regras ok)`)
  for (const v of r.violations) console.log(`    - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nós) ${v.nodes[0]?.html.slice(0, 140)}\n      ${v.nodes[0]?.failureSummary?.replace(/\n/g, ' | ').slice(0, 260)}`)
}

async function main(): Promise<void> {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR' })).newPage()
  await p.goto(URL)
  await p.waitForSelector('.app')
  await audit(p, 'aguardando o cliente')
  await p.getByRole('radio', { name: 'Demo' }).click()
  for (let i = 0; i < 6; i++) await p.getByRole('button', { name: 'Próximo passo' }).click()
  await p.getByRole('radio', { name: /Meio/ }).click()
  await p.waitForSelector('.hero', { timeout: 20000 })
  // espera o carregamento terminar e as animações de entrada assentarem (contraste medido em opacidade 1)
  await p.waitForFunction(() => !document.body.innerText.includes('Confrontos '), null, { timeout: 90000 })
  await p.waitForTimeout(1200)
  await audit(p, 'demo com recomendações')
  await p.getByRole('button', { name: /Ver como foi calculado/ }).click()
  await p.locator('.row-main').first().click()
  await p.waitForTimeout(500)
  await audit(p, 'detalhes expandidos')
  await p.getByRole('radio', { name: 'Manual' }).click()
  await p.getByRole('button', { name: /Inimigo 2/ }).click()
  await p.waitForSelector('.popover')
  await audit(p, 'seletor de campeão aberto')
  await p.keyboard.press('Escape')
  for (const tab of ['Preferências', 'Pool e exclusões', 'Dados e fontes', 'Sobre']) {
    await p.getByRole('button', { name: 'Abrir configurações' }).click()
    await p.getByRole('tab', { name: tab }).click()
    await p.waitForTimeout(350)
    await audit(p, `configurações › ${tab}`)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(300)
  }
  await b.close()
  console.log(total === 0 ? '\nSem violações detectáveis.' : `\n${total} violação(ões).`)
  process.exit(total === 0 ? 0 : 1)
}
main().catch((e) => {
  console.error(e)
  process.exit(2)
})
