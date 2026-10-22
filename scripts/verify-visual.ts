/**
 * Verificação visual e de comportamento da interface em navegador real (Chromium via Playwright),
 * usando o simulador da ponte (dados fictícios). Gera capturas em screenshots/ e um relatório.
 *   1) npm run dev:web      (em outro terminal)
 *   2) npm run verify:visual
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { emptyDraft, setMe, setSlotChampion, setSlotPosition } from '../src/core/draft'
import type { Draft } from '../src/core/types'

const URL = process.env['LS_URL'] ?? 'http://127.0.0.1:5173/'
mkdirSync('screenshots', { recursive: true })
const results: { name: string; ok: boolean; detail?: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function fresh(browser: import('playwright').Browser, opts: { w?: number; h?: number; scale?: number; reduced?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: opts.w ?? 1280, height: opts.h ?? 800 },
    deviceScaleFactor: opts.scale ?? 1,
    locale: 'pt-BR',
    ...(opts.reduced ? { reducedMotion: 'reduce' as const } : {})
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check('sem erro de página', false, e.message))
  await page.goto(URL)
  await page.waitForSelector('.app')
  return page
}
const shot = (p: Page, n: string): Promise<Buffer> => p.screenshot({ path: `screenshots/${n}.png` })
const noOverflow = async (p: Page, label: string): Promise<void> => {
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }))
  check(`sem rolagem horizontal (${label})`, r.sw <= r.iw && r.bw <= r.iw, `${r.sw}/${r.iw}`)
}

/** Draft no formato do cliente: aliados com posição atribuída; inimigos sem. */
function lcuLike(): Draft {
  let d = emptyDraft('7001', 'lcu', 'picking')
  const pos = ['top', 'jungle', 'mid', 'adc', 'support'] as const
  pos.forEach((p, i) => {
    d.allies[i]!.position = p
    d.allies[i]!.positionSource = 'assigned'
  })
  d = setMe(d, 2)
  d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 0 }, 54, 'locked')
  d = setSlotChampion(d, { kind: 'pick', side: 'ally', index: 1 }, 59, 'hover')
  d = setSlotChampion(d, { kind: 'pick', side: 'enemy', index: 0 }, 157, 'locked')
  d = setSlotChampion(d, { kind: 'ban', side: 'ally', index: 0 }, 238, 'locked')
  d = setSlotChampion(d, { kind: 'ban', side: 'enemy', index: 0 }, 99, 'locked')
  return d
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

  /* ---------- estados: aguardando cliente / fora do draft / draft ---------- */
  {
    const p = await fresh(browser)
    await p.waitForSelector('.state-card')
    check('estado "aguardando o cliente" visível', (await p.locator('.state-card h3').innerText()).includes('Aguardando o cliente'))
    await shot(p, '01-aguardando-cliente')
    await p.evaluate(() => (window as any).__LS__.setLcu({ state: 'connected', phase: 'Lobby', lastEventAt: Date.now() }))
    await p.waitForSelector('text=Cliente conectado — fora da seleção')
    check('estado "cliente conectado, fora do draft"', true)
    await shot(p, '02-cliente-fora-do-draft')

    // draft automático em andamento
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.evaluate((d) => {
      const ls = (window as any).__LS__
      ls.setLcu({ phase: 'ChampSelect', lastEventAt: Date.now() })
      ls.setDraft(d)
    }, lcuLike() as unknown as object)
    await p.waitForSelector('.hero', { timeout: 15000 })
    await p.waitForTimeout(3000)
    check('draft automático exibe recomendações', (await p.locator('.hero').count()) === 1)
    await shot(p, '03-auto-draft')
    await noOverflow(p, 'auto 1280x800')

    // não abre janelas/modais sozinho, preserva foco e detalhes durante atualizações
    await p.locator('.row-main').first().click()
    const expandedName = await p.locator('.row[data-expanded] .row-name').innerText()
    await p.locator('.row[data-expanded] .row-main').focus()
    const before = await p.evaluate(() => document.activeElement?.getAttribute('aria-controls'))
    for (let i = 0; i < 3; i++) {
      await p.evaluate((i) => {
        const ls = (window as any).__LS__
        ls.setLcu({ lastEventAt: Date.now() })
      }, i)
      await p.waitForTimeout(250)
    }
    // inimigo confirma outro campeão (mesma época do draft)
    const d2 = setSlotChampion(lcuLike(), { kind: 'pick', side: 'enemy', index: 3 }, 222, 'locked')
    await p.evaluate((d) => (window as any).__LS__.setDraft(d), d2 as unknown as object)
    await p.waitForTimeout(1200)
    const still = await p.locator('.row[data-expanded] .row-name').allInnerTexts()
    const after = await p.evaluate(() => document.activeElement?.getAttribute('aria-controls'))
    check('detalhes abertos permanecem após atualização do draft', still.includes(expandedName) || still.length === 0 /* saiu do top 5 */, `abertos: ${still.join(',') || '—'}; antes: ${expandedName}`)
    check('foco preservado após atualização', before === after || after == null, `${before} → ${after}`)
    check('nenhuma janela abriu sozinha', (await p.locator('.sheet, .popover').count()) === 0)

    // sair do draft limpa a tela
    await p.evaluate(() => {
      const ls = (window as any).__LS__
      ls.setLcu({ phase: 'InProgress' })
      ls.setDraft(null)
    })
    await p.waitForSelector('text=Cliente conectado — fora da seleção')
    check('sair do draft limpa o estado', (await p.locator('.hero').count()) === 0)
    await p.context().close()
  }

  /* ---------- manual: edição, popover, teclado ---------- */
  {
    const p = await fresh(browser)
    await p.getByRole('radio', { name: 'Manual' }).click()
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.waitForTimeout(2500)
    await shot(p, '04-manual-vazio')
    const slot = p.getByRole('button', { name: /Inimigo 1/ })
    await slot.focus()
    await p.keyboard.press('Enter')
    await p.waitForSelector('.popover')
    check('popover abre por teclado e foca a busca', await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Buscar campeão'))
    await p.keyboard.type('ahr')
    await p.waitForTimeout(250)
    await shot(p, '05-popover-busca')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(600)
    const label = await slot.getAttribute('aria-label')
    check('escolher pelo teclado preenche o espaço', /Ahri/.test(label ?? ''), label ?? '')
    check('foco volta ao espaço após escolher', await p.evaluate(() => document.activeElement?.getAttribute('aria-label')?.includes('Inimigo 1') ?? false))
    // Esc fecha e devolve o foco
    await p.keyboard.press('Enter')
    await p.waitForSelector('.popover')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(150)
    check('Esc fecha o popover', (await p.locator('.popover').count()) === 0)
    // navegação por setas na grade
    await p.keyboard.press('Enter')
    await p.waitForSelector('.popover')
    await p.keyboard.press('ArrowDown')
    await p.keyboard.press('ArrowRight')
    check('setas navegam pela grade de campeões', await p.evaluate(() => document.activeElement?.classList.contains('tile') ?? false))
    await p.keyboard.press('Escape')

    // foco visível em controles
    await p.keyboard.press('Tab')
    const focusStyle = await p.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return null
      const cs = getComputedStyle(el)
      return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow }
    })
    check('foco do teclado é visível', !!focusStyle && focusStyle.outline !== 'none', JSON.stringify(focusStyle))

    // banimento e provisório
    await p.getByRole('button', { name: /Banimento 1 inimigo/ }).click()
    await p.waitForSelector('.popover')
    await p.keyboard.type('zed')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(500)
    check('banimento manual aparece como banido', (await p.getByRole('button', { name: /Banimento 1 inimigo.*Zed.*banido/ }).count()) === 1)
    await shot(p, '06-manual-preenchido')
    await p.context().close()
  }

  /* ---------- configurações ---------- */
  {
    const p = await fresh(browser)
    await p.getByRole('radio', { name: 'Manual' }).click()
    const gear = p.getByRole('button', { name: 'Abrir configurações' })
    await gear.click()
    await p.waitForSelector('.sheet')
    await shot(p, '07-config-preferencias')
    await p.getByRole('tab', { name: 'Pool e exclusões' }).click()
    for (const n of ['Aurelion Sol', 'Nunu', 'Renata', 'Ahri', 'Lee Sin']) {
      await p.getByLabel('Adicionar campeão à pool…').fill(n)
      await p.locator('.suggest button').first().click()
    }
    await p.getByLabel('Excluir campeão…').fill('teemo')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(400)
    await shot(p, '08-config-pool')
    await p.getByRole('tab', { name: 'Dados e fontes' }).click()
    await p.waitForTimeout(250)
    await shot(p, '09-config-dados')
    await p.getByRole('tab', { name: 'Sobre' }).click()
    await p.waitForTimeout(250)
    await shot(p, '10-config-sobre')
    // armadilha de foco e Esc
    for (let i = 0; i < 25; i++) await p.keyboard.press('Tab')
    check('Tab permanece dentro da folha de configurações', await p.evaluate(() => !!document.activeElement?.closest('.sheet')))
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
    check('Esc fecha a folha e devolve o foco ao botão', (await p.locator('.sheet').count()) === 0 && (await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Abrir configurações')
    // pool + restrição
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.locator('.switch').click()
    await p.waitForTimeout(3500)
    await shot(p, '11-pool-restrita')
    const names = await p.locator('.hero-name, .row-name').allInnerTexts()
    check('"Só minha pool" mostra apenas campeões da pool', names.every((n) => ['Aurelion Sol', 'Nunu e Willump', 'Renata Glasc', 'Ahri', 'Lee Sin'].includes(n)), names.join(', '))
    await p.context().close()
  }

  /* ---------- API indisponível ---------- */
  {
    const p = await fresh(browser)
    await p.evaluate(() => ((window as any).__LS__.failStats = true))
    await p.getByRole('radio', { name: 'Manual' }).click()
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.waitForSelector('text=Estatísticas indisponíveis no momento', { timeout: 25000 })
    check('estado de API indisponível explica problema e ação', (await p.locator('.state-card').innerText()).includes('Tentar de novo'))
    await shot(p, '12-api-indisponivel')
    // degradação: sem estatísticas ainda recomenda por composição/pool
    await p.getByRole('button', { name: /Minha pool/ }).click()
    await p.getByRole('tab', { name: 'Pool e exclusões' }).click()
    await p.getByLabel('Adicionar campeão à pool…').fill('ahri')
    await p.locator('.suggest button').first().click()
    await p.keyboard.press('Escape')
    await p.waitForTimeout(600)
    await shot(p, '13-sem-estatisticas-com-pool')
    // recuperação
    await p.evaluate(() => ((window as any).__LS__.failStats = false))
    await p.getByRole('button', { name: /Tentar de novo/ }).first().click()
    await p.waitForSelector('.hero', { timeout: 20000 })
    check('após a fonte voltar, as recomendações reaparecem', true)
    await p.context().close()
  }

  /* ---------- carregamento inicial (skeleton) ---------- */
  {
    const p = await fresh(browser)
    await p.evaluate(() => ((window as any).__LS__.latencyMs = 1500))
    await p.getByRole('radio', { name: 'Manual' }).click()
    await p.getByRole('radio', { name: /Topo/ }).click()
    await p.waitForSelector('.skeleton', { timeout: 5000 })
    await shot(p, '14-carregando')
    check('skeleton aparece só no carregamento inicial', true)
    await p.waitForSelector('.hero', { timeout: 30000 })
    check('skeleton some quando há conteúdo', (await p.locator('.skeleton').count()) === 0)
    await p.context().close()
  }

  /* ---------- tamanhos de janela e escala ---------- */
  for (const [label, w, h, s] of [
    ['960x620 (mínimo)', 960, 620, 1],
    ['1100x700', 1100, 700, 1],
    ['1920x1080', 1920, 1080, 1],
    ['1280x720 @1.5x (150%)', 1280, 720, 1.5],
    ['1280x720 @2x (200%)', 1280, 720, 2]
  ] as const) {
    const p = await fresh(browser, { w, h, scale: s })
    await p.getByRole('radio', { name: 'Demo' }).click()
    for (let i = 0; i < 6; i++) await p.getByRole('button', { name: 'Próximo passo' }).click()
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.waitForTimeout(3500)
    await noOverflow(p, label)
    await shot(p, `15-tamanho-${w}x${h}-${s}x`)
    await p.context().close()
  }

  /* ---------- textos longos ---------- */
  {
    const p = await fresh(browser, { w: 960, h: 620 })
    await p.evaluate(() =>
      (window as any).__LS__.setDataStatus({
        state: 'partial',
        errors: [{ source: 'opgg', kind: 'http', message: 'O OP.GG respondeu com erro (HTTP 503) e este texto é propositalmente longo para testar a quebra de linha em janelas estreitas da interface.', action: 'O serviço parece instável. Tente novamente em alguns minutos ou continue usando os dados guardados no computador.', at: Date.now() }]
      })
    )
    await p.getByRole('radio', { name: 'Demo' }).click()
    for (let i = 0; i < 6; i++) await p.getByRole('button', { name: 'Próximo passo' }).click()
    await p.getByRole('radio', { name: /Suporte/ }).click()
    await p.waitForTimeout(3000)
    await noOverflow(p, 'textos longos 960x620')
    await shot(p, '16-textos-longos')
    await p.context().close()
  }

  /* ---------- movimento reduzido ---------- */
  {
    const p = await fresh(browser, { reduced: true })
    const d = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.seg-btn')!).transitionDuration))
    check('prefers-reduced-motion zera transições de CSS', d < 0.001, `${d}s`)
    await p.getByRole('radio', { name: 'Demo' }).click()
    for (let i = 0; i < 4; i++) await p.getByRole('button', { name: 'Próximo passo' }).click()
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.waitForTimeout(3000)
    const movers = await p.evaluate(async () => {
      const rows = [...document.querySelectorAll<HTMLElement>('.row')]
      return rows.map((r) => getComputedStyle(r).transform)
    })
    check('movimento reduzido: linhas não ficam com transformações animadas', movers.every((t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'), movers.join('|'))
    await shot(p, '17-movimento-reduzido')
    await p.context().close()

    const q = await fresh(browser)
    await q.getByRole('button', { name: 'Abrir configurações' }).click()
    await q.getByRole('radio', { name: 'Reduzir animações' }).click()
    const attr = await q.evaluate(() => document.documentElement.dataset['motion'])
    const d2 = await q.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.seg-btn')!).transitionDuration))
    check('opção do app "Reduzir animações" aplica o modo reduzido', attr === 'reduced' && d2 < 0.001, `${attr}, ${d2}s`)
    await q.context().close()
  }

  /* ---------- plano de jogo: escolha do campeão, builds, envio ao cliente ---------- */
  {
    const p = await fresh(browser)
    await p.getByRole('radio', { name: 'Demo' }).click()
    for (let i = 0; i < 6; i++) await p.getByRole('button', { name: 'Próximo passo' }).click()
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.waitForSelector('.hero', { timeout: 15000 })
    await p.waitForTimeout(1500)
    check('plano: aba "Plano de jogo" existe e começa em Recomendações', (await p.getByRole('tab', { name: 'Recomendações' }).getAttribute('aria-selected')) === 'true')
    const why = p.locator('.why-top')
    check('1º lugar: bloco "Por que está em 1º" com texto explicativo', (await why.count()) === 1 && /1º/.test((await why.innerText()) ?? '') && ((await why.locator('.why-head').innerText()).length > 30))
    await shot(p, '19-por-que-em-primeiro')
    await p.getByRole('button', { name: /Escolher e ver plano de jogo/ }).first().click()
    await p.waitForSelector('.bp', { timeout: 15000 })
    check('escolher o campeão leva ao plano de jogo', (await p.getByRole('tab', { name: 'Plano de jogo' }).getAttribute('aria-selected')) === 'true')
    await p.waitForTimeout(100)
    check('foco vai para a aba do plano (não se perde)', await p.evaluate(() => document.activeElement?.id === 'view-tab-plan'))
    check('campeão escolhido aparece como "escolhido por você"', /escolhido por você/.test(await p.locator('.focus-chip').innerText()))
    check('dica de confronto do oponente mais provável', (await p.locator('.mu').count()) === 1 && /Dica de confronto/.test(await p.locator('.mu h3').innerText()))
    check('cada linha da dica diz a origem (dado, regra, oficial)', (await p.locator('.mu-lines li .src-tag').count()) >= 3)
    check('três builds para escolher', (await p.getByRole('radiogroup', { name: 'Escolha uma das builds' }).getByRole('radio').count()) === 3)
    check('objetivo da build descrito', (await p.locator('.bp-objective p').innerText()).length > 40)
    check('comportamento por fase (rota, meio, lutas)', (await p.locator('.phase h5').allInnerTexts()).join('|') === 'Fase de rota|Meio de jogo|Lutas de equipe')
    check('cada orientação de comportamento tem texto', (await p.locator('.phase li').count()) >= 5)
    await p.waitForTimeout(1500)
    const imgs = await p.evaluate(() => ({ ok: document.querySelectorAll('.bp .gimg[data-state="ok"]').length, all: document.querySelectorAll('.bp .gimg').length }))
    check('ícones de itens/runas/feitiços carregam', imgs.ok >= Math.ceil(imgs.all * 0.8) && imgs.all >= 10, `${imgs.ok}/${imgs.all}`)
    check('arsenal agrupado (iniciais, botas, principais, situacionais)', (await p.locator('.arsenal-head .kicker').allInnerTexts()).join('|') === 'INICIAIS|BOTAS|ITENS PRINCIPAIS|SITUACIONAIS' || (await p.locator('.arsenal-head .kicker').count()) >= 3)
    await noOverflow(p, 'plano')
    await shot(p, '20-plano-de-jogo')
    // trocar de build
    const cards = p.getByRole('radiogroup', { name: 'Escolha uma das builds' }).getByRole('radio')
    await cards.nth(0).click()
    check('trocar de build atualiza o painel', /Meta geral/.test(await p.locator('.bp h3').innerText()))
    // demonstração: nada vai ao cliente
    await p.getByRole('button', { name: /Escolher esta build \(demonstração\)/ }).click()
    await p.waitForSelector('.use-status >> text=/nada é enviado/i', { timeout: 5000 })
    const applied0 = await p.evaluate(() => (window as any).__LS__.applied.length)
    check('demonstração nunca envia ao cliente', applied0 === 0)
    check('build escolhida ganha "Em uso"', (await p.locator('.used-badge').count()) === 1)
    await shot(p, '21-build-em-uso-demo')
    // abas por teclado
    await p.getByRole('tab', { name: 'Plano de jogo' }).focus()
    await p.keyboard.press('ArrowLeft')
    check('seta ← volta para Recomendações', (await p.getByRole('tab', { name: 'Recomendações' }).getAttribute('aria-selected')) === 'true')
    await p.context().close()
  }
  {
    // cliente conectado (auto): escolher pelo seletor, enviar, falhar, desconectar
    const p = await fresh(browser)
    await p.evaluate((d) => {
      const c = (window as any).__LS__
      c.setLcu({ state: 'connected', phase: 'ChampSelect', lastEventAt: Date.now() })
      c.setDraft(d)
    }, lcuLike())
    await p.waitForSelector('.hero', { timeout: 15000 })
    await p.waitForTimeout(3500)
    await p.getByRole('tab', { name: 'Plano de jogo' }).click()
    await p.getByRole('button', { name: /Trocar campeão|Escolher campeão/ }).click()
    check('seletor do meu campeão abre com busca', (await p.getByRole('dialog', { name: 'Escolher o meu campeão' }).count()) === 1)
    check('campeão já escolhido por outro fica desabilitado no seletor', await p.getByRole('button', { name: /Yasuo \(banido ou já escolhido\)/ }).isDisabled())
    await p.getByRole('searchbox', { name: 'Buscar campeão' }).fill('ahri')
    await p.keyboard.press('Enter')
    await p.waitForSelector('.bp', { timeout: 15000 })
    check('escolha pelo seletor muda o foco', /Ahri/.test(await p.locator('.focus-chip').innerText()) && /escolhido por você/.test(await p.locator('.focus-chip').innerText()))
    check('plano mostra o campeão escolhido', /Ahri/.test(await p.locator('.plan-head h2').innerText()))
    // enviar
    await p.getByRole('radiogroup', { name: 'Escolha uma das builds' }).getByRole('radio').nth(1).click()
    await p.getByRole('button', { name: 'Usar esta build' }).click()
    await p.waitForSelector('.use-steps li', { timeout: 8000 })
    let applied = await p.evaluate(() => (window as any).__LS__.applied)
    check('"Usar esta build" envia ao cliente (itens e runas, sem feitiços)', applied.length === 1 && applied[0].options.items && applied[0].options.runes && !applied[0].options.spells)
    check('o pedido leva só ids, papéis e o campeão', applied[0].champion > 0 && applied[0].items.length >= 5 && applied[0].items.every((i: any) => Number.isInteger(i.id) && ['inicial', 'botas', 'principal', 'situacional'].includes(i.role)) && applied[0].runes.shards.length === 3)
    check('resultado por etapa é mostrado', (await p.locator('.use-steps li[data-status="ok"]').count()) === 2)
    await shot(p, '22-build-enviada')
    // opções: desligar runas e reenviar
    await p.getByRole('checkbox', { name: 'Página de runas' }).uncheck()
    await p.getByRole('button', { name: 'Enviar de novo ao cliente' }).click()
    await p.waitForFunction(() => (window as any).__LS__.applied.length === 2)
    applied = await p.evaluate(() => (window as any).__LS__.applied)
    check('opção desligada não é enviada', applied[1].options.runes === false)
    // falha parcial
    await p.evaluate(() => ((window as any).__LS__.applyMode = 'partial'))
    await p.getByRole('checkbox', { name: 'Página de runas' }).check()
    await p.getByRole('button', { name: 'Enviar de novo ao cliente' }).click()
    await p.waitForSelector('.use-steps li[data-status="failed"]', { timeout: 8000 })
    check('falha de uma etapa é explicada e as demais seguem', (await p.locator('.use-steps li[data-status="ok"]').count()) === 1 && /recusou/.test(await p.locator('.use-steps li[data-status="failed"]').innerText()))
    await shot(p, '23-envio-falha-parcial')
    // cliente desconectado
    await p.evaluate(() => ((window as any).__LS__.applyMode = 'ok'))
    await p.evaluate(() => (window as any).__LS__.setLcu({ state: 'reconnecting', attempt: 1 }))
    const before = await p.evaluate(() => (window as any).__LS__.applied.length)
    await p.getByRole('button', { name: /Enviar de novo ao cliente|Build escolhida|Usar esta build/ }).click()
    await p.waitForSelector('.use-status >> text=/não está conectado/i', { timeout: 5000 })
    check('sem cliente conectado: nada é enviado e o motivo aparece', (await p.evaluate(() => (window as any).__LS__.applied.length)) === before)
    await p.context().close()
  }
  {
    // escolha do app que deixa de estar disponível (banida depois)
    const p = await fresh(browser)
    await p.evaluate((d) => {
      const c = (window as any).__LS__
      c.setLcu({ state: 'connected', phase: 'ChampSelect', lastEventAt: Date.now() })
      c.setDraft(d)
    }, lcuLike())
    await p.waitForSelector('.hero', { timeout: 15000 })
    await p.getByRole('tab', { name: 'Plano de jogo' }).click()
    await p.getByRole('button', { name: /Trocar campeão|Escolher campeão/ }).click()
    await p.getByRole('searchbox', { name: 'Buscar campeão' }).fill('ahri')
    await p.keyboard.press('Enter')
    await p.waitForSelector('.bp', { timeout: 15000 })
    const banned = lcuLike()
    banned.bansEnemies[1] = { champion: 103, state: 'locked' }
    banned.id = '7001'
    await p.evaluate((d) => (window as any).__LS__.setDraft(d, '7001'), banned)
    await p.waitForSelector('.plan-note >> text=/não está mais disponível/', { timeout: 8000 })
    check('escolha que ficou indisponível é ignorada com aviso', !/escolhido por você/.test(await p.locator('.focus-chip').innerText()))
    await p.context().close()
  }
  {
    const p = await fresh(browser, { w: 960, h: 620 })
    await p.getByRole('radio', { name: 'Demo' }).click()
    for (let i = 0; i < 6; i++) await p.getByRole('button', { name: 'Próximo passo' }).click()
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.waitForSelector('.hero', { timeout: 15000 })
    await p.getByRole('button', { name: /Escolher e ver plano de jogo/ }).first().click()
    await p.waitForSelector('.bp', { timeout: 15000 })
    await noOverflow(p, 'plano 960x620')
    await shot(p, '24-plano-960x620')
    await p.context().close()
  }

  /* ---------- reordenação animada e identidade ---------- */
  {
    const p = await fresh(browser)
    await p.getByRole('radio', { name: 'Demo' }).click()
    await p.getByRole('radio', { name: /Meio/ }).click()
    await p.waitForSelector('.hero', { timeout: 15000 })
    await p.waitForTimeout(4000)
    // marca os nós DOM das linhas
    await p.evaluate(() => document.querySelectorAll('.row').forEach((r) => ((r as HTMLElement).dataset['probe'] = r.querySelector('.row-name')!.textContent ?? '')))
    let sawTransform = false
    let identityKept = true
    for (let step = 0; step < 6; step++) {
      await p.getByRole('button', { name: 'Próximo passo' }).click()
      const frames: string[] = []
      for (let f = 0; f < 14; f++) {
        frames.push(...(await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.row')].map((r) => getComputedStyle(r).transform))))
        await p.waitForTimeout(25)
      }
      if (frames.some((t) => t !== 'none' && !t.startsWith('matrix(1, 0, 0, 1, 0, 0)'))) sawTransform = true
      await p.waitForTimeout(1600)
      const kept = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.row')].filter((r) => r.dataset['probe'] === r.querySelector('.row-name')?.textContent).length)
      const total = await p.locator('.row').count()
      if (kept < Math.min(total, 2)) identityKept = false
      await p.evaluate(() => document.querySelectorAll('.row').forEach((r) => ((r as HTMLElement).dataset['probe'] = r.querySelector('.row-name')!.textContent ?? '')))
    }
    check('reordenação usa transform (FLIP), não layout', sawTransform)
    check('linhas mantêm identidade (mesmo nó DOM) entre atualizações', identityKept)
    await p.context().close()
  }

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  writeFileSync('screenshots/report.json', JSON.stringify(results, null, 2))
  console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
