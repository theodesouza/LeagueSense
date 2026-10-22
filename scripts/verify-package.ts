/**
 * Abre o app.asar empacotado (versão Linux do Electron, sob Xvfb) e confere que a janela sobe e a ponte
 * existe. Não substitui testar o instalador no Windows.   xvfb-run -a npx tsx scripts/verify-package.ts
 */
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'

async function main(): Promise<void> {
  const asar = resolve(__dirname, '../release/win-unpacked/resources/app.asar')
  const app = await electron.launch({ args: ['--no-sandbox', '--disable-gpu', asar], env: { ...process.env, LEAGUESENSE_USER_DATA: '/tmp/ls-asar-ud' } })
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30000 })
  const bridge = await page.evaluate(() => typeof (window as unknown as { leaguesense?: { prefs?: { get?: unknown } } }).leaguesense?.prefs?.get)
  const roster = await page.evaluate(async () => (await (window as unknown as { leaguesense: { roster: { get(): Promise<{ champions: unknown[]; source: string }> } } }).leaguesense.roster.get()).champions.length)
  console.log(`app.asar iniciou: ponte=${bridge}, campeões=${roster}, título="${await page.title()}"`)
  await app.close()
  process.exit(bridge === 'function' && roster > 100 ? 0 : 1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
