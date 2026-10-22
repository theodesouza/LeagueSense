import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, Download, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { fmtAge, fmtInt } from '@core/format'
import { FAMILIARITY_LABEL, type ChampionInfo, type Familiarity } from '@core/types'
import { levelFromMastery } from '@core/engine'
import type { AppInfo } from '@shared/api'
import { api } from '../api'
import { Portrait } from './Portrait'
import { useApp, type SheetTab } from '../state/store'

const TABS: [SheetTab, string][] = [['prefs', 'Preferências'], ['pool', 'Pool e exclusões'], ['data', 'Dados e fontes'], ['about', 'Sobre']]
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function ChampionAdd({ onPick, taken, label }: { onPick: (id: number) => void; taken: Set<number>; label: string }): ReactElement {
  const { champions, version } = useApp()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const n = norm(q.trim())
    if (!n) return []
    return [...champions.values()].filter((c) => !taken.has(c.id) && (norm(c.name).includes(n) || norm(c.nameEn).includes(n))).slice(0, 8)
  }, [q, champions, taken])
  return (
    <div className="add-box">
      <label className="search">
        <Search size={15} aria-hidden="true" />
        <input type="search" placeholder={label} aria-label={label} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { onPick(matches[0].id); setQ('') } }} />
      </label>
      {open && matches.length > 0 && (
        <ul className="suggest" role="listbox" aria-label="Sugestões">
          {matches.map((c) => (
            <li key={c.id} role="option" aria-selected="false">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(c.id); setQ('') }}>
                <Portrait champion={c} version={version} size={28} />
                <span>{c.name}</span>
                <Plus size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PoolTab(): ReactElement {
  const { state, setPrefs, champions, version } = useApp()
  const pool = state.prefs.pool
  const entries = Object.entries(pool).map(([id, lvl]) => ({ c: champions.get(Number(id)), id: Number(id), lvl })).sort((a, b) => b.lvl - a.lvl || (a.c?.name ?? '').localeCompare(b.c?.name ?? '', 'pt-BR'))
  const excluded = state.prefs.excluded.map((id) => ({ id, c: champions.get(id) }))
  const mastery = state.player?.mastery ?? {}
  const canImport = Object.keys(mastery).length > 0
  const importMastery = (): void => {
    const top = Object.entries(mastery).sort((a, b) => b[1].points - a[1].points).slice(0, 12)
    const next = { ...pool }
    for (const [id, m] of top) {
      const lvl = levelFromMastery(m.points)
      if (lvl && next[Number(id)] == null) next[Number(id)] = lvl
    }
    setPrefs({ pool: next })
  }
  const setLevel = (id: number, lvl: Familiarity): void => setPrefs({ pool: { ...pool, [id]: lvl } })
  const remove = (id: number): void => {
    const { [id]: _drop, ...rest } = pool
    void _drop
    setPrefs({ pool: rest })
  }
  return (
    <div className="tab-body">
      <section>
        <div className="sec-head">
          <h3>Minha pool</h3>
          <p className="muted small">Campeões que você joga e o quanto domina cada um. Eles ganham (ou perdem) pontos conforme a familiaridade; ative “Só minha pool” para ver apenas eles.</p>
        </div>
        <div className="sec-tools">
          <ChampionAdd label="Adicionar campeão à pool…" taken={new Set(Object.keys(pool).map(Number))} onPick={(id) => setPrefs({ pool: { ...pool, [id]: 2 } })} />
          <button type="button" className="btn ghost" disabled={!canImport} title={canImport ? 'Usa a maestria lida do cliente (somente leitura)' : 'Disponível quando o cliente estiver conectado'} onClick={importMastery}>
            <Download size={15} />Importar da maestria
          </button>
        </div>
        {entries.length === 0 ? <p className="muted empty-note">Sua pool está vazia. Sem pool, nenhum campeão recebe bônus ou penalidade de familiaridade.</p> : (
          <ul className="pool-list">
            {entries.map(({ id, c, lvl }) => (
              <li key={id}>
                <Portrait champion={c} version={version} size={36} />
                <span className="pool-name" title={c?.name}>{c?.name ?? `Campeão ${id}`}</span>
                <div className="seg sm" role="radiogroup" aria-label={`Familiaridade com ${c?.name ?? id}`}>
                  {([1, 2, 3, 4] as Familiarity[]).map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={lvl === l} className="seg-btn" onClick={() => setLevel(id, l)}>{FAMILIARITY_LABEL[l]}</button>
                  ))}
                </div>
                <button type="button" className="icon-btn" aria-label={`Remover ${c?.name ?? id} da pool`} onClick={() => remove(id)}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="sec-head">
          <h3>Não quero ver / não possuo</h3>
          <p className="muted small">Campeões excluídos nunca aparecem nas recomendações.{state.player?.owned ? ' A posse também é lida do cliente.' : ''}</p>
        </div>
        <label className="check"><input type="checkbox" checked={state.prefs.hideUnowned} onChange={(e) => setPrefs({ hideUnowned: e.target.checked })} /><span>Esconder campeões que o cliente diz que não possuo{state.player?.owned ? '' : ' (indisponível sem o cliente)'}</span></label>
        <div className="sec-tools"><ChampionAdd label="Excluir campeão…" taken={new Set(state.prefs.excluded)} onPick={(id) => setPrefs({ excluded: [...state.prefs.excluded, id] })} /></div>
        {excluded.length > 0 && (
          <ul className="chip-list">
            {excluded.map(({ id, c }) => (
              <li key={id} className="chip-item"><Ban size={13} aria-hidden="true" />{c?.name ?? id}<button type="button" aria-label={`Voltar a mostrar ${c?.name ?? id}`} onClick={() => setPrefs({ excluded: state.prefs.excluded.filter((x) => x !== id) })}><X size={13} /></button></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function PrefsTab(): ReactElement {
  const { state, setPrefs } = useApp()
  return (
    <div className="tab-body">
      <section>
        <div className="sec-head"><h3>Região</h3></div>
        <label className="field"><span>Sua região</span>
          <select value={state.prefs.region} onChange={(e) => setPrefs({ region: e.target.value })}>
            {['BR', 'NA', 'EUW', 'EUNE', 'LAN', 'LAS', 'KR', 'JP', 'OCE', 'TR', 'RU'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <p className="note"><strong>Limitação:</strong> o OP.GG não permite filtrar as estatísticas de campeões por região; os números são um agregado global. A região fica guardada e é exibida, mas não muda o cálculo.</p>
      </section>
      <section>
        <div className="sec-head"><h3>Peso das preferências pessoais</h3><p className="muted small">Quanto sua familiaridade pesa frente às estatísticas.</p></div>
        <div className="seg" role="radiogroup" aria-label="Peso da familiaridade">
          {([[0.5, 'Meta primeiro'], [1, 'Equilibrado'], [1.5, 'Conforto primeiro']] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={state.prefs.familiarityWeight === v} className="seg-btn" onClick={() => setPrefs({ familiarityWeight: v })}>{l}</button>
          ))}
        </div>
      </section>
      <section>
        <div className="sec-head"><h3>Animações</h3><p className="muted small">“Sistema” segue a preferência de movimento reduzido do Windows.</p></div>
        <div className="seg" role="radiogroup" aria-label="Animações">
          {([['system', 'Seguir o sistema'], ['reduced', 'Reduzir animações'], ['full', 'Completas']] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={state.prefs.motion === v} className="seg-btn" onClick={() => setPrefs({ motion: v })}>{l}</button>
          ))}
        </div>
      </section>
    </div>
  )
}

function DataTab(): ReactElement {
  const { state, dispatch } = useApp()
  const d = state.data
  const l = state.lcu
  const [busy, setBusy] = useState(false)
  return (
    <div className="tab-body">
      <section>
        <div className="sec-head"><h3>Fontes de dados</h3></div>
        <dl className="sources">
          <div><dt>Data Dragon (Riot) <span className="tag">oficial</span></dt><dd>Lista de campeões e imagens · versão {state.roster?.version ?? '—'} · origem: {state.roster?.source === 'live' ? 'ao vivo' : state.roster?.source === 'cache' ? 'cache' : 'embutida (offline)'}</dd></div>
          <div><dt>OP.GG MCP <span className="tag">terceiros</span></dt><dd>
            {d.demo ? 'Modo demonstração: dados fictícios.' : d.state === 'error' ? 'Indisponível.' : d.state === 'ready' || d.state === 'partial' ? `Funcionando${d.fromCache ? ' (cache)' : ''}.` : 'Ainda não consultado.'}
            {d.lastUpdated ? ` Atualizado ${fmtAge(Date.now() - d.lastUpdated)}.` : ''}
            <span className="muted small block">Sem chave de API; sem termos de uso publicados. Consultas com cache e no máximo 3 em paralelo.</span>
            {d.errors.map((e, i) => <span key={i} className="err-line">{e.message} {e.action}</span>)}
          </dd></div>
          <div><dt>Cliente do LoL (LCU) <span className="tag warn">não oficial</span></dt><dd>
            {l.state === 'connected' ? `Conectado · ${l.phase}${l.region ? ` · ${l.region}` : ''}` : l.state === 'reconnecting' ? `Reconectando (tentativa ${l.attempt})` : 'Aguardando o cliente abrir.'}
            {l.detail && <span className="muted small block">{l.detail}</span>}
            <span className="muted small block">Leitura local (127.0.0.1) do estado da seleção, posse e maestria. A Riot não dá suporte oficial a esta interface.</span>
          </dd></div>
        </dl>
      </section>
      <section>
        <div className="sec-head"><h3>Ações</h3></div>
        <div className="sec-tools">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { setBusy(true); void api.app.clearCache().then(() => api.stats.refresh()).finally(() => setBusy(false)) }}><RefreshCw size={15} />Atualizar dados (limpa o cache)</button>
          <button type="button" className="btn ghost" onClick={() => void api.lcu.reconnect()}>Reconectar ao cliente</button>
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'mode', mode: 'demo' })}>Abrir demonstração</button>
        </div>
      </section>
    </div>
  )
}

function AboutTab(): ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void api.app.info().then(setInfo), [])
  const link = (url: string, label: string): ReactElement => <button type="button" className="link-btn" onClick={() => void api.app.openExternal(url)}>{label}</button>
  return (
    <div className="tab-body">
      <section>
        <div className="sec-head"><h3>LeagueSense {info?.version ?? ''}</h3><p className="muted small">Assistente de draft para uso pessoal. Você decide: o app só sugere e explica.</p></div>
        <p className="note">{info?.disclaimer}</p>
      </section>
      <section>
        <div className="sec-head"><h3>Privacidade</h3></div>
        <p className="small">Nada é enviado a servidores do LeagueSense (não existe servidor). Preferências ficam em <code>{info?.userData ?? '—'}</code>. As consultas externas vão ao Data Dragon e ao OP.GG e levam apenas nomes de campeões, posição e elo. Nenhuma chave de API é usada ou guardada.</p>
      </section>
      <section>
        <div className="sec-head"><h3>Referências</h3></div>
        <p className="small">{link('https://developer.riotgames.com/docs/lol', 'Documentação da Riot')} · {link('https://developer.riotgames.com/policies/general', 'Políticas para desenvolvedores')} · {link('https://github.com/opgginc/opgg-mcp', 'OP.GG MCP')}</p>
        <p className="muted small">Versões — Electron {info?.electron ?? '—'} · {info?.platform ?? '—'}. Registre o app no Developer Portal e informe o uso do LCU (veja docs/INTEGRACOES.md).</p>
      </section>
    </div>
  )
}

export function Sheet(): ReactElement | null {
  const { state, dispatch } = useApp()
  const tab = state.sheet
  const ref = useRef<HTMLDivElement | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!tab) return
    lastFocus.current = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dispatch({ type: 'sheet', tab: null })
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter((el) => el.offsetParent !== null)
        if (f.length === 0) return
        const first = f[0]!
        const last = f[f.length - 1]!
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      lastFocus.current?.focus?.()
    }
  }, [tab, dispatch])

  return createPortal(
    <AnimatePresence>
      {tab && (
        <div className="sheet-root">
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={() => dispatch({ type: 'sheet', tab: null })} />
          <motion.aside ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="Configurações" initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
            <header className="sheet-head">
              <h2>Configurações</h2>
              <button type="button" className="icon-btn" aria-label="Fechar configurações" onClick={() => dispatch({ type: 'sheet', tab: null })}><X size={18} /></button>
            </header>
            <div className="tabs" role="tablist" aria-label="Seções">
              {TABS.map(([k, l]) => (
                <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} tabIndex={tab === k ? 0 : -1} className="tab" onClick={() => dispatch({ type: 'sheet', tab: k })}
                  onKeyDown={(e) => {
                    const i = TABS.findIndex(([x]) => x === tab)
                    if (e.key === 'ArrowRight') dispatch({ type: 'sheet', tab: TABS[(i + 1) % TABS.length]![0] })
                    if (e.key === 'ArrowLeft') dispatch({ type: 'sheet', tab: TABS[(i + TABS.length - 1) % TABS.length]![0] })
                  }}>{l}</button>
              ))}
            </div>
            <div className="sheet-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'prefs' && <PrefsTab />}
              {tab === 'pool' && <PoolTab />}
              {tab === 'data' && <DataTab />}
              {tab === 'about' && <AboutTab />}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
void fmtInt
export type { ChampionInfo }
