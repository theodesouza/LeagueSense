import { useMemo, type ReactElement } from 'react'
import { Check, CircleAlert, CircleCheck, Info, LoaderCircle, MinusCircle, Send, Target, TriangleAlert } from 'lucide-react'
import type { Catalog, PlannedBuild, PlannedItem } from '@core/build-types'
import { SHARDS } from '@core/catalog'
import { fmtInt, fmtPct } from '@core/format'
import type { ApplyBuildRequest, ApplyStep } from '@shared/api'
import { api } from '../api'
import { useApp, type BuildUse } from '../state/store'
import { ItemIcon, RuneIcon, ShardIcon, SpellIcon } from './GameIcons'

const ROLE_TITLE: Record<PlannedItem['role'], string> = {
  inicial: 'Iniciais',
  botas: 'Botas',
  principal: 'Itens principais',
  situacional: 'Situacionais'
}
const ROLES: PlannedItem['role'][] = ['inicial', 'botas', 'principal', 'situacional']
const ROLE_HELP: Record<PlannedItem['role'], string> = {
  inicial: 'Compra inicial na base.',
  botas: 'Botas escolhidas para esta partida.',
  principal: 'Núcleo da build, na ordem de compra.',
  situacional: '4º ao 6º item, escolhidos pelos times.'
}

/* ------------------------------- itens ------------------------------- */

function Arsenal({ build, catalog, version }: { build: PlannedBuild; catalog: Catalog | null; version: string }): ReactElement {
  const iv = catalog?.version ?? version
  return (
    <section className="bp-sec" aria-labelledby="bp-arsenal">
      <h4 id="bp-arsenal">Itens da build <span className="muted small">— este é o “arsenal” que vai para o jogo</span></h4>
      <div className="arsenal">
        {ROLES.map((r) => {
          const items = build.items.filter((i) => i.role === r)
          if (items.length === 0) return null
          return (
            <div className="arsenal-group" key={r}>
              <div className="arsenal-head">
                <span className="kicker">{ROLE_TITLE[r]}</span>
                <span className="muted small">{ROLE_HELP[r]}</span>
              </div>
              <ul className="items">
                {items.map((it, i) => (
                  <li key={`${it.id}-${i}`} className="item">
                    <ItemIcon id={it.id} name={it.name} version={iv} size={44} />
                    <span className="item-body">
                      <span className="item-name">{it.name}</span>
                      {it.plain && <span className="item-plain">{it.plain}</span>}
                      {it.why.map((w, k) => (
                        <span className="item-why" key={k}><Check size={12} aria-hidden="true" />{w}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------- runas, feitiços, habilidades ------------------------------- */

function Runes({ build, catalog, version }: { build: PlannedBuild; catalog: Catalog | null; version: string }): ReactElement {
  const r = build.runes
  if (!r) return <p className="muted small">Sem página de runas disponível para esta build.</p>
  const iv = catalog?.version ?? version
  const p = r.page
  const style = (id: number): ReactElement => <RuneIcon style={catalog?.styles[id]} fallbackName={`Estilo ${id}`} version={iv} size={22} />
  const rune = (id: number, big = false): ReactElement => {
    const info = catalog?.runes[id]
    return (
      <li key={id} className="rune" data-key={big || undefined}>
        <RuneIcon rune={info} fallbackName={`Runa ${id}`} version={iv} size={big ? 34 : 26} />
        <span>{info?.name ?? `Runa ${id}`}</span>
      </li>
    )
  }
  return (
    <div className="runes">
      <div className="rune-col">
        <div className="rune-style">{style(p.primaryStyle)}<span>{catalog?.styles[p.primaryStyle]?.name ?? 'Estilo principal'}</span></div>
        <ul>{p.primaryRunes.map((id, i) => rune(id, i === 0))}</ul>
      </div>
      <div className="rune-col">
        <div className="rune-style">{style(p.secondaryStyle)}<span>{catalog?.styles[p.secondaryStyle]?.name ?? 'Estilo secundário'}</span></div>
        <ul>{p.secondaryRunes.map((id) => rune(id))}</ul>
        <div className="rune-style shards-title"><span className="kicker">Fragmentos</span></div>
        <ul>
          {p.shards.map((id, i) => {
            const sh = SHARDS[id]
            return (
              <li key={`${id}-${i}`} className="rune">
                {sh ? <ShardIcon icon={sh.icon} name={sh.name} version={iv} /> : <RuneIcon fallbackName={`Fragmento ${id}`} version={iv} size={24} />}
                <span>{sh?.name ?? `Fragmento ${id}`}</span>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="muted small rune-sample">{r.sample}</p>
    </div>
  )
}

function Spells({ build, catalog, version }: { build: PlannedBuild; catalog: Catalog | null; version: string }): ReactElement {
  const s = build.spells
  if (!s) return <p className="muted small">Sem feitiços sugeridos.</p>
  const iv = catalog?.version ?? version
  return (
    <div>
      <ul className="spells">
        {s.ids.map((id, i) => (
          <li key={`${id}-${i}`} className="spell">
            <SpellIcon spell={catalog?.spells[id]} fallbackId={id} version={iv} size={34} />
            <span>{catalog?.spells[id]?.name ?? s.names[i] ?? `Feitiço ${id}`}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">{s.sample}</p>
    </div>
  )
}

function Skills({ build }: { build: PlannedBuild }): ReactElement {
  const k = build.skills
  if (!k) return <p className="muted small">Sem ordem de habilidades disponível.</p>
  const letters = ['Q', 'W', 'E', 'R']
  const levels = Array.from({ length: 15 }, (_, i) => i)
  return (
    <div>
      {k.priority.length > 0 && <p className="skill-prio">Prioridade: <strong>{k.priority.join(' › ')}</strong></p>}
      <div className="skill-grid" aria-hidden="true">
        {letters.map((l) => (
          <div className="skill-row" key={l}>
            <span className="skill-key">{l}</span>
            {levels.map((i) => (
              <span key={i} className="skill-cell" data-on={k.order[i] === l || undefined}>{k.order[i] === l ? i + 1 : ''}</span>
            ))}
          </div>
        ))}
      </div>
      <p className="sr-only">Ordem dos pontos de habilidade: {k.order.map((l, i) => `nível ${i + 1} ${l}`).join(', ')}.</p>
      <p className="muted small">{k.sample}</p>
    </div>
  )
}

/* ------------------------------- usar a build ------------------------------- */

const STEP_ICON: Record<ApplyStep['status'], ReactElement> = {
  ok: <CircleCheck size={15} />,
  skipped: <MinusCircle size={15} />,
  failed: <CircleAlert size={15} />
}

function UseStatus({ use }: { use: BuildUse }): ReactElement {
  if (use.phase === 'sending') {
    return <p className="use-line"><LoaderCircle size={15} className="spin" aria-hidden="true" />Enviando ao cliente…</p>
  }
  if (!use.result) {
    return <p className="use-line" data-tone="info"><Info size={15} aria-hidden="true" />{use.skipped ?? 'Build escolhida no app.'}</p>
  }
  return (
    <ul className="use-steps">
      {use.result.steps.map((s, i) => (
        <li key={i} data-status={s.status}>
          <span aria-hidden="true">{STEP_ICON[s.status]}</span>
          <span>{s.message}</span>
        </li>
      ))}
    </ul>
  )
}

export function UseBuild({ build, champion }: { build: PlannedBuild; champion: number }): ReactElement {
  const { state, dispatch, champions, setPrefs } = useApp()
  const opts = state.prefs.sendBuild
  const demo = state.mode === 'demo'
  const connected = state.lcu.state === 'connected'
  const mine = state.use && state.use.champion === champion && state.use.build === build.id ? state.use : null
  const inUse = mine != null
  const sending = state.use?.phase === 'sending'
  const canSpells = !!build.spells && build.spells.ids.length === 2

  const run = async (): Promise<void> => {
    const at = Date.now()
    const base = { champion, build: build.id, title: build.title, at }
    if (demo) {
      dispatch({ type: 'use', use: { ...base, phase: 'done', result: null, skipped: 'Modo demonstração: a build foi escolhida só no app. Nada é enviado ao cliente do jogo porque os dados são fictícios.' } })
      return
    }
    if (!connected) {
      dispatch({ type: 'use', use: { ...base, phase: 'done', result: null, skipped: 'O cliente do League of Legends não está conectado. A build ficou escolhida no app; abra o cliente e use “Enviar de novo ao cliente”.' } })
      return
    }
    dispatch({ type: 'use', use: { ...base, phase: 'sending', result: null, skipped: null } })
    const req: ApplyBuildRequest = {
      champion,
      championName: champions.get(champion)?.name ?? `Campeão ${champion}`,
      buildTitle: build.title,
      items: build.items.map((i) => ({ id: i.id, role: i.role })),
      runes: build.runes ? { primaryStyle: build.runes.page.primaryStyle, primaryRunes: build.runes.page.primaryRunes, secondaryStyle: build.runes.page.secondaryStyle, secondaryRunes: build.runes.page.secondaryRunes, shards: build.runes.page.shards } : null,
      spells: canSpells ? build.spells!.ids : null,
      options: opts
    }
    try {
      const result = await api.lcu.applyBuild(req)
      dispatch({ type: 'useDone', at, result })
    } catch {
      dispatch({ type: 'useDone', at, result: { ok: false, at: Date.now(), steps: [{ what: 'items', status: 'failed', message: 'Não foi possível enviar ao cliente (erro interno). Tente de novo.' }] } })
    }
  }

  const label = demo ? 'Escolher esta build (demonstração)' : inUse ? (connected ? 'Enviar de novo ao cliente' : 'Build escolhida') : 'Usar esta build'
  const nothing = !opts.items && !opts.runes && !(opts.spells && canSpells)
  return (
    <div className="use-box">
      <button type="button" className="btn primary" disabled={sending || (!demo && connected && nothing)} onClick={() => void run()} aria-describedby="use-help">
        {sending ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
        {label}
      </button>
      <fieldset className="use-opts" disabled={sending}>
        <legend className="sr-only">O que enviar ao cliente</legend>
        <label className="check"><input type="checkbox" checked={opts.items} onChange={(e) => setPrefs({ sendBuild: { ...opts, items: e.target.checked } })} /><span>Conjunto de itens</span></label>
        <label className="check"><input type="checkbox" checked={opts.runes} onChange={(e) => setPrefs({ sendBuild: { ...opts, runes: e.target.checked } })} disabled={!build.runes} /><span>Página de runas</span></label>
        <label className="check" title="Só altera durante a seleção de campeões; Flash fica na segunda posição."><input type="checkbox" checked={opts.spells && canSpells} onChange={(e) => setPrefs({ sendBuild: { ...opts, spells: e.target.checked } })} disabled={!canSpells} /><span>Feitiços (na seleção)</span></label>
      </fieldset>
      <p id="use-help" className="muted small">
        {demo
          ? 'Em demonstração nada é escrito no cliente.'
          : 'Ao usar, o LeagueSense salva no cliente um conjunto de itens e uma página de runas com o nome “LeagueSense …”. Seus outros conjuntos e páginas não são alterados nem apagados.'}
      </p>
      <div role="status" aria-live="polite" className="use-status">{mine && <UseStatus use={mine} />}</div>
    </div>
  )
}

/* ------------------------------- painel da build ------------------------------- */

function Behavior({ build }: { build: PlannedBuild }): ReactElement {
  return (
    <section className="bp-sec" aria-labelledby="bp-how">
      <h4 id="bp-how">Como jogar com esta build</h4>
      <div className="phases">
        {build.behavior.map((g) => (
          <div className="phase" key={g.phase}>
            <h5>{g.phase}</h5>
            <ul>
              {g.items.map((it, i) => (
                <li key={i}>
                  <span>{it.text}</span>
                  {it.because && <span className="because"><Info size={12} aria-hidden="true" />Por quê: {it.because}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="muted small note-heur">Objetivo e comportamento são orientações geradas por regras sobre o tipo do campeão, os dois times e (quando há) os dados do confronto. Não são estatística nem garantia de resultado.</p>
    </section>
  )
}

export function BuildPanel({ build, champion, catalog, version }: { build: PlannedBuild; champion: number; catalog: Catalog | null; version: string }): ReactElement {
  const winRate = build.evidence.winRate
  const labelId = useMemo(() => `bp-${build.id}`, [build.id])
  return (
    <article className="bp" aria-labelledby={labelId}>
      <header className="bp-head">
        <div>
          <p className="kicker">{build.archetype}</p>
          <h3 id={labelId}>{build.title}</h3>
          <p className="muted small">{build.subtitle}</p>
          <p className="bp-evidence small">
            {build.evidence.play != null && <span className="tabular">{fmtInt(build.evidence.play)} partidas{winRate != null ? ` · ${fmtPct(winRate)} de vitórias` : ''}</span>}
            <span className="muted"> {build.evidence.label}</span>
          </p>
        </div>
        <UseBuild build={build} champion={champion} />
      </header>

      <section className="bp-objective" aria-labelledby="bp-obj">
        <h4 id="bp-obj"><Target size={15} aria-hidden="true" />Objetivo nesta partida</h4>
        <p>{build.objective}</p>
      </section>

      <Arsenal build={build} catalog={catalog} version={version} />

      <div className="bp-trio">
        <section className="bp-sec" aria-labelledby="bp-runes"><h4 id="bp-runes">Runas</h4><Runes build={build} catalog={catalog} version={version} /></section>
        <section className="bp-sec" aria-labelledby="bp-spells"><h4 id="bp-spells">Feitiços</h4><Spells build={build} catalog={catalog} version={version} /></section>
        <section className="bp-sec" aria-labelledby="bp-skills"><h4 id="bp-skills">Habilidades</h4><Skills build={build} /></section>
      </div>

      <Behavior build={build} />

      {build.adaptations.length > 0 && (
        <section className="bp-sec" aria-labelledby="bp-adapt">
          <h4 id="bp-adapt">O que os times mudaram nesta build</h4>
          <ul className="bullets">{build.adaptations.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      )}
      {build.caveats.length > 0 && (
        <ul className="caveats">{build.caveats.map((c, i) => <li key={i}><TriangleAlert size={14} aria-hidden="true" /><span>{c}</span></li>)}</ul>
      )}
    </article>
  )
}
