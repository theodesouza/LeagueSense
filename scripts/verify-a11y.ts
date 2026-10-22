/**
 * Auditoria automática de acessibilidade (axe-core) em estados-chave, no navegador com o simulador.
 * Cobre regras WCAG A/AA detectáveis por máquina (contraste, nomes acessíveis, ARIA, etc.). Não substitui
 * teste manual com leitor de tela.   (com `npm run dev:web` ativo)  npx tsx scripts/verify-a11y.ts
 */
import AxeBuilder from '@axe-core/playwright'
import { chromium, type Page } from 'playwright'
import { emptyDraft, setMe, setSlotChampion } from '../src/core/draft'
import type { Draft } from '../src/core/types'

const URL = process.env['LS_URL'] ?? 'http://127.0.0.1:5173/'
let total = 0

async function audit(p: Page, name: string): Promise<void> {
  const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  total += r.violations.length
  console.log(`${r.violations.length === 0 ? '✔' : '✘'} ${name}: ${r.violations.length} violações (${r.passes.length} regras ok)`)
  for (const v of r.violations) console.log(`    - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nós) ${v.nodes[0]?.html.slice(0, 140)}\n      ${v.nodes[0]?.failureSummary?.replace(/\n/g, ' | ').slice(0, 260)}`)
}

function lcuLike(): Draft {
  let d = emptyDraft('7001', 'lcu', 'picking')
  ;(['top', 'jungle', 'mid', 'adc', 'support'] as const).forEach((pos, i) => {
    d.allies[i]!.position = pos
    d.allies[i]!.positionSource = 'assigned'
  })
  d = setMe(d, 2)
  d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 0 }, 54, 'locked')
  d = setSlotChampion(d, { kind: 'pick', side: 'enemy', index: 0 }, 157, 'locked')
  return d
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
  // plano de jogo (demo): aba, seletor do meu campeão, build em uso
  await p.getByRole('button', { name: /Escolher e ver plano de jogo/ }).first().click()
  await p.waitForSelector('.bp', { timeout: 20000 })
  await p.waitForTimeout(1500)
  await audit(p, 'plano de jogo')
  await p.getByRole('button', { name: /Escolher esta build \(demonstração\)/ }).click()
  await p.waitForSelector('.use-status >> text=/nada é enviado/i')
  await p.waitForTimeout(400)
  await audit(p, 'plano de jogo › build escolhida (demonstração)')
  await p.getByRole('button', { name: 'Trocar campeão' }).click()
  await p.waitForSelector('.popover')
  await p.waitForTimeout(300)
  await audit(p, 'seletor do meu campeão aberto')
  await p.keyboard.press('Escape')
  await p.getByRole('tab', { name: 'Recomendações' }).click()
  // cliente conectado: envio com sucesso e com falha parcial
  await p.getByRole('radio', { name: 'Automático' }).click()
  await p.evaluate((d) => {
    const c = (window as any).__LS__
    c.setLcu({ state: 'connected', phase: 'ChampSelect', lastEventAt: Date.now() })
    c.setDraft(d)
  }, lcuLike())
  await p.waitForSelector('.hero', { timeout: 20000 })
  await p.waitForTimeout(3500)
  await p.getByRole('tab', { name: 'Plano de jogo' }).click()
  await p.getByRole('button', { name: /Trocar campeão|Escolher campeão/ }).click()
  await p.getByRole('searchbox', { name: 'Buscar campeão' }).fill('ahri')
  await p.keyboard.press('Enter')
  await p.waitForSelector('.bp', { timeout: 20000 })
  await p.getByRole('button', { name: 'Usar esta build' }).click()
  await p.waitForSelector('.use-steps li')
  await p.waitForTimeout(500)
  await audit(p, 'plano de jogo › envio ao cliente concluído')
  await p.evaluate(() => ((window as any).__LS__.applyMode = 'partial'))
  await p.getByRole('button', { name: 'Enviar de novo ao cliente' }).click()
  await p.waitForSelector('.use-steps li[data-status="failed"]')
  await p.waitForTimeout(500)
  await audit(p, 'plano de jogo › envio com falha parcial')
  await p.getByRole('tab', { name: 'Recomendações' }).click()
  await p.waitForTimeout(500)
  await audit(p, 'recomendações com campeão escolhido')
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
