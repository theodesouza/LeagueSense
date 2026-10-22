/**
 * Captura de tela do renderer no navegador com o simulador da ponte (dev). Uso:
 *   npx tsx scripts/shot.ts <nome> [largura] [altura] [escala] [cenário]
 * Cenários: demo:N (modo demo no passo N) | manual | auto-wait | auto-idle | error
 */
import { chromium } from 'playwright'

const [name = 'shot', w = '1280', h = '800', scale = '1', scenario = 'demo:6'] = process.argv.slice(2)

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(scale), locale: 'pt-BR' })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text()))
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.goto('http://127.0.0.1:5173/')
  await page.waitForSelector('.app')
  if (scenario.startsWith('demo')) {
    await page.getByRole('radio', { name: 'Demo' }).click()
    const step = parseInt(scenario.split(':')[1] ?? '6', 10)
    for (let i = 0; i < step; i++) await page.getByRole('button', { name: 'Próximo passo' }).click()
    await page.getByRole('radio', { name: /Meio/ }).click()
    await page.waitForTimeout(3500)
  } else if (scenario === 'manual') {
    await page.getByRole('radio', { name: 'Manual' }).click()
    await page.waitForTimeout(600)
  } else if (scenario === 'error') {
    await page.evaluate(() => ((window as any).__LS__.failStats = true))
    await page.getByRole('radio', { name: 'Manual' }).click()
    await page.getByRole('radio', { name: /Meio/ }).click()
    await page.waitForTimeout(4500)
  }
  if (scenario.includes('+expand')) {
    await page.getByRole('button', { name: /Ver como foi calculado/ }).first().click()
    await page.waitForTimeout(500)
  }
  if (scenario.includes('+row')) {
    await page.locator('.row-main').first().click()
    await page.waitForTimeout(500)
  }
  if (scenario.includes('+plan')) {
    await page.getByRole('button', { name: /Escolher e ver plano de jogo/ }).first().click()
    await page.waitForSelector('.bp', { timeout: 15000 })
    await page.waitForTimeout(700)
  }
  if (scenario.includes('+use')) {
    await page.getByRole('button', { name: /Usar esta build|Escolher esta build/ }).click()
    await page.waitForSelector('.use-status >> text=/./', { timeout: 8000 })
    await page.waitForTimeout(400)
  }
  if (scenario.includes('+scroll')) {
    await page.locator('.recs-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await page.locator('.main').evaluate((el, y) => (el.scrollTop = y > 0 ? y : el.scrollHeight), Number(process.env['SCROLL'] ?? 0))
    await page.waitForTimeout(200)
  }
  await page.screenshot({ path: `screenshots/${name}.png` })
  console.log('ok', name)
  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
