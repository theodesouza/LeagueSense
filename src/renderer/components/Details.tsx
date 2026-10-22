import type { ReactElement } from 'react'
import { Info, TriangleAlert } from 'lucide-react'
import { ELO_LABEL, fmtAge, fmtInt, fmtPct, fmtSignedPp } from '@core/format'
import { POSITION_LABEL, type ChampionInfo, type Factor, type Position, type Provenance, type Recommendation } from '@core/types'
import { KindIcon } from './icons'

const GROUPS: { key: Factor['group']; title: string; help: string }[] = [
  { key: 'estatistica', title: 'Evidências estatísticas', help: 'Taxas de vitória reais (OP.GG), já ajustadas pelo tamanho da amostra.' },
  { key: 'composicao', title: 'Composição do time', help: 'Heurísticas de equilíbrio (dano, frente, engajamento…). Não usam estatísticas.' },
  { key: 'pessoal', title: 'Preferências pessoais', help: 'Sua pool e familiaridade.' }
]

function Contribution({ pp }: { pp: number }): ReactElement {
  const w = Math.abs(pp) < 0.05 ? 0 : Math.max(8, Math.min(100, (Math.abs(pp) / 5) * 100))
  const sign = pp > 0.049 ? 'positivo' : pp < -0.049 ? 'negativo' : 'neutro'
  return (
    <span className="contrib" data-sign={sign} role="img" aria-label={`Contribuição ${sign}: ${fmtSignedPp(pp)} pontos percentuais equivalentes`}>
      <span className="contrib-bar" aria-hidden="true">
        <i style={{ width: `${w / 2}%`, [pp >= 0 ? 'left' : 'right']: '50%' }} />
      </span>
      <span className="contrib-num">{fmtSignedPp(pp)}</span>
    </span>
  )
}

export function provenanceLine(p: Provenance | null, rec: Recommendation, position: Position | null): string {
  if (!p) return 'Sem estatísticas: pontuação baseada apenas em composição e preferências.'
  if (p.source === 'demo') return 'DADOS FICTÍCIOS de demonstração — não refletem o jogo real.'
  const parts = [
    'Fonte: OP.GG',
    p.patch ? `patch ${p.patch}` : 'patch não informado',
    ELO_LABEL[p.tier] ?? p.tier,
    rec.sample.base != null ? `${fmtInt(rec.sample.base)} partidas${position ? ` como ${POSITION_LABEL[position]}` : ''}` : 'sem amostra',
    'região: global (não filtrável)'
  ]
  if (p.fromCache && p.fetchedAt) parts.push(`em cache ${fmtAge(Date.now() - p.fetchedAt)}`)
  return parts.join(' · ')
}

export function Details({
  rec,
  provenance,
  position,
  champions
}: {
  rec: Recommendation
  provenance: Provenance | null
  position: Position | null
  champions: ReadonlyMap<number, ChampionInfo>
}): ReactElement {
  const stat = rec.factors.filter((f) => f.group === 'estatistica')
  return (
    <div className="details">
      <section aria-labelledby={`calc-${rec.championId}`}>
        <h4 id={`calc-${rec.championId}`}>Como esta pontuação foi calculada</h4>
        <p className="muted small">
          Cada fator vale uma quantidade de pontos percentuais equivalentes (p.p.). A soma ordena as opções; <strong>não é chance de vitória</strong>.
        </p>
        {GROUPS.map((g) => {
          const fs = rec.factors.filter((f) => f.group === g.key)
          return (
            <div className="factor-group" key={g.key}>
              <div className="factor-group-head">
                <span className="kicker">{g.title}</span>
                <span className="muted small">{g.help}</span>
              </div>
              {fs.length === 0 ? (
                <p className="muted small factor-none">{g.key === 'composicao' ? 'Nenhuma necessidade de composição identificada (ou poucos aliados definidos).' : g.key === 'pessoal' ? 'Sem preferência registrada para este campeão.' : 'Sem evidência estatística disponível.'}</p>
              ) : (
                <ul>
                  {fs.map((f, i) => (
                    <li key={`${f.kind}-${i}`} className="factor">
                      <KindIcon kind={f.kind} />
                      <span className="factor-text">{f.text}</span>
                      <Contribution pp={f.pp} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        <div className="factor-total">
          <span>Soma</span>
          <span className="tabular">{fmtSignedPp(rec.totalPp)} p.p. → adequação {Math.round(rec.score)}/100</span>
        </div>
      </section>

      <section aria-label="Dados usados">
        <h4>Dados usados</h4>
        <dl className="facts">
          <div><dt>Taxa de vitória na rota</dt><dd>{rec.baseWinRate != null ? fmtPct(rec.baseWinRate) : 'sem dados'}{rec.sample.base != null ? ` · ${fmtInt(rec.sample.base)} partidas` : ''}</dd></div>
          {rec.laneOpponents.length > 0 && (
            <div>
              <dt>Oponente de rota provável</dt>
              <dd>
                {rec.laneOpponents.slice(0, 3).map((o) => (
                  <span key={o.champion} className="opp">
                    {champions.get(o.champion)?.name ?? o.champion} ({Math.round(o.probability * 100)}%)
                    {o.winRate != null ? ` — ${fmtPct(o.winRate)} em ${fmtInt(o.play ?? 0)}` : ' — sem confronto'}
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div><dt>Familiaridade</dt><dd>{rec.familiarity.source === 'pool' ? 'definida por você' : rec.familiarity.source === 'maestria' ? `estimada pela maestria (${fmtInt(rec.familiarity.points ?? 0)} pts)` : 'não registrada'}</dd></div>
        </dl>
        {rec.caveats.length > 0 && (
          <ul className="caveats">
            {rec.caveats.map((c, i) => (
              <li key={i}><TriangleAlert size={14} aria-hidden="true" /><span>{c.text}</span></li>
            ))}
          </ul>
        )}
        <p className="prov small"><Info size={13} aria-hidden="true" /> {provenanceLine(provenance, rec, position)}</p>
        {stat.length === 0 && <span className="sr-only">Sem estatísticas</span>}
      </section>
    </div>
  )
}
