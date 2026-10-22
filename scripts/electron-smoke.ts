/**
 * Teste de fumaça no Electron real (sob Xvfb): ponte/preload, dados reais (Data Dragon + OP.GG) e
 * draft ao vivo vindo de um LCU FALSO (não é o cliente do jogo). Gera capturas em screenshots/.
 *   xvfb-run -a npx tsx scripts/electron-smoke.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { FakeLcu, makeSession } from '../tests/helpers/fake-lcu'

const log: { name: string; ok: boolean; detail?: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  log.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  mkdirSync('screenshots', { recursive: true })
  const lcu = new FakeLcu()
  await lcu.start()
  const lcuDir = mkdtempSync(join(tmpdir(), 'ls-lcu-'))
  writeFileSync(join(lcuDir, 'lockfile'), lcu.lockfile())
  const userData = mkdtempSync(join(tmpdir(), 'ls-user-'))

  lcu.owned = [157, 54, 59, 103, 61, 4, 99, 238, 91, 7, 13, 134, 90, 268, 245, 115].map((id) => ({ id, ownership: { owned: true } }))
  lcu.mastery = [{ championId: 103, championPoints: 142000, championLevel: 10 }, { championId: 61, championPoints: 61000, championLevel: 8 }, { championId: 4, championPoints: 9000, championLevel: 5 }]

  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', 'out/main/index.js'],
    env: { ...process.env, LEAGUESENSE_USER_DATA: userData, LEAGUESENSE_LCU_DIR: lcuDir }
  })
  const page = await app.firstWindow()
  const violations: string[] = []
  page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text().slice(0, 160)))
  page.on('pageerror', (e) => check('sem erro de página', false, e.message))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForSelector('.app')

  const bridge = await page.evaluate(() => typeof (window as any).leaguesense?.prefs?.get)
  check('ponte (preload) disponível, sem acesso direto ao Node', bridge === 'function' && (await page.evaluate(() => typeof (window as any).require === 'undefined' && typeof (window as any).process === 'undefined')))

  // cliente conectado, fora do draft
  await page.waitForSelector('text=Cliente conectado', { timeout: 20000 })
  check('LCU falso detectado pelo lockfile e conectado', true)
  await page.screenshot({ path: 'screenshots/e1-conectado-fora-do-draft.png' })

  // entra na seleção de campeões: aliados com posição atribuída (como na ranqueada solo/duo), inimigos sem
  const session = (counter: number, opts: Omit<Parameters<typeof makeSession>[0], 'counter'>) => makeSession({ ...opts, counter })
  const base = {
    localCellId: 2,
    myTeam: [
      { cellId: 0, championId: 54, position: 'top' },
      { cellId: 1, intent: 59, position: 'jungle' },
      { cellId: 2, position: 'middle' },
      { cellId: 3, position: 'bottom' },
      { cellId: 4, position: 'utility' }
    ],
    theirTeam: [{ cellId: 5 }, { cellId: 6 }, { cellId: 7 }, { cellId: 8 }, { cellId: 9 }],
    actions: [
      { actorCellId: 0, championId: 54, completed: true, type: 'pick' as const, isAllyAction: true },
      { actorCellId: 1, championId: 59, completed: false, type: 'pick' as const, isAllyAction: true, isInProgress: true },
      { actorCellId: 0, championId: 238, completed: true, type: 'ban' as const, isAllyAction: true },
      { actorCellId: 5, championId: 99, completed: true, type: 'ban' as const, isAllyAction: false }
    ],
    myTeamBans: [238],
    theirTeamBans: [99]
  }
  lcu.phase = 'ChampSelect'
  lcu.session = session(1, base)
  lcu.emit('OnJsonApiEvent_lol-gameflow_v1_gameflow-phase', 'ChampSelect')
  lcu.emit('OnJsonApiEvent_lol-champ-select_v1_session', lcu.session)
  await page.waitForSelector('.slot[data-state="locked"]', { timeout: 15000 })
  check('draft detectado automaticamente (pick confirmado + provisório + bans)', (await page.locator('.slot[data-state="hover"]').count()) === 1 && (await page.locator('.ban[data-state="locked"]').count()) === 2)

  // escolhe posição do cliente (Meio já vem atribuída) e espera dados reais
  await page.waitForSelector('.hero, .state-card', { timeout: 60000 })
  await page.waitForTimeout(500)
  const live = await page.evaluate(async () => (await (window as any).leaguesense.stats.status()))
  await page.waitForFunction(() => document.querySelector('.hero') != null, null, { timeout: 90000 })
  await page.waitForTimeout(8000)
  const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth > 0).length)
  check('imagens de campeões carregam pelo protocolo local (Data Dragon)', imgs >= 3, `${imgs} imagens`)
  const t0 = Date.now()
  await page.waitForFunction(() => /patch \d/.test(document.querySelector('.hero .prov')?.textContent ?? ''), null, { timeout: 90000 }).catch(() => undefined)
  const st = await page.evaluate(async () => (await (window as any).leaguesense.stats.status()))
  const prov = await page.locator('.hero .prov').innerText()
  console.log(`patch exibido após ${Date.now() - t0} ms; estado dos dados: ${st.state}, erros: ${st.errors.length}`)
  check('procedência mostra OP.GG, patch e elo (dados reais)', /OP\.GG/.test(prov) && /patch \d+\.\d+/.test(prov), prov)
  await page.screenshot({ path: 'screenshots/e2-draft-ao-vivo.png' })

  // inimigo confirma Yasuo e Jinx: posição de rota inferida e recomendação se atualiza
  lcu.session = session(2, {
    ...base,
    theirTeam: [{ cellId: 5, championId: 157 }, { cellId: 6 }, { cellId: 7 }, { cellId: 8, championId: 222 }, { cellId: 9 }],
    actions: [...base.actions, { actorCellId: 5, championId: 157, completed: true, type: 'pick' as const, isAllyAction: false }, { actorCellId: 8, championId: 222, completed: true, type: 'pick' as const, isAllyAction: false }]
  })
  lcu.emit('OnJsonApiEvent_lol-champ-select_v1_session', lcu.session)
  await page.waitForFunction(() => !document.body.innerText.includes('Confrontos '), null, { timeout: 150000 })
  await page.waitForTimeout(2500)
  const text = await page.locator('.recs').innerText()
  check('recomendações citam o oponente de rota provável', /Yasuo/.test(text))
  await page.screenshot({ path: 'screenshots/e3-inimigos-escolhidos.png' })

  // sai do draft
  lcu.phase = 'InProgress'
  lcu.emit('OnJsonApiEvent_lol-gameflow_v1_gameflow-phase', 'InProgress')
  await page.waitForSelector('text=Cliente conectado — fora da seleção', { timeout: 10000 })
  check('ao sair do draft o estado é limpo', (await page.locator('.hero').count()) === 0)

  // queda do cliente → reconectando → procurando
  await lcu.close()
  await page.waitForSelector('text=/Reconectando|Aguardando o cliente/', { timeout: 15000 })
  check('queda do cliente é sinalizada (reconexão)', true)
  await page.screenshot({ path: 'screenshots/e4-cliente-caiu.png' })

  check('nenhuma violação de CSP no app real', violations.length === 0, violations.join(' | '))

  // configurações (captura com pool preenchida)
  await page.evaluate(() => (window as any).leaguesense.prefs.set({ pool: { 103: 4, 61: 3, 4: 2, 134: 2, 91: 1 } }))
  await page.getByRole('button', { name: 'Abrir configurações' }).click()
  await page.getByRole('tab', { name: 'Pool e exclusões' }).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'screenshots/e5-config-pool.png' })
  await page.keyboard.press('Escape')

  // preferências persistem em disco
  await page.evaluate(() => (window as any).leaguesense.prefs.set({ elo: 'GOLD', pool: { 103: 4 } }))
  await page.waitForTimeout(700)
  const saved = await page.evaluate(async () => (await (window as any).leaguesense.prefs.get()))
  check('preferências aceitas pelo processo principal', saved.elo === 'GOLD' && saved.pool['103'] === 4)
  await app.close()
  const { readFileSync } = await import('node:fs')
  const file = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
  check('preferências gravadas em settings.json', file.prefs.elo === 'GOLD' && file.prefs.pool['103'] === 4)
  void live
  const failed = log.filter((l) => !l.ok)
  console.log(`\n${log.length - failed.length}/${log.length} verificações passaram`)
  process.exit(failed.length ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(2)
})
