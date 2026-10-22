# Direção visual (definida antes da implementação da tela)

**Conceito:** uma "mesa de decisão" escura e calma. Os retratos dos campeões são a única coisa colorida; a
interface é grafite com **uma** cor de destaque. Nada pisca; o movimento só explica mudança de estado.

## Paleta (tokens em `src/renderer/styles/tokens.css`)

| Papel | Token | Valor | Observação |
|---|---|---|---|
| Janela | `--bg-0` | `#0D0F13` | fundo do app |
| Painel | `--bg-1` | `#13161B` | colunas e barras |
| Superfície elevada | `--bg-2` | `#191D23` | cartões, campos |
| Hover / campo ativo | `--bg-3` / `--bg-4` | `#20252C` / `#272D36` | |
| Bordas | `--line-1` / `--line-2` | `#242932` / `#323945` | sempre 1 px, discretas |
| Texto | `--text-1/2/3` | `#E9ECF1` / `#AEB6C2` / `#8A93A1` | contrastes verificados (ver abaixo) |
| **Destaque** | `--accent` | `#5CC8B4` (azul‑petróleo suave) | **única** cor de marca: seleção, foco, #1 |
| Aliados | `--ally` | = destaque | identificação por rótulo + posição, não só cor |
| Inimigos | `--enemy` | `#C98A8A` (rosa‑poeira) | dessaturado; ≠ cor de erro |
| Aviso | `--warn` | `#E2B15C` | riscos e dados parciais |
| Erro | `--danger` | `#F0645C` | apenas falhas |

Sem gradientes decorativos: o único gradiente é um *scrim* funcional que garante legibilidade do texto sobre a
arte do campeão (texto nunca fica diretamente sobre o retrato).

## Tipografia

* **Inter Variable** (UI, dados, números com `font-variant-numeric: tabular-nums`).
* **Sora Variable** (marca, nome do campeão em destaque, pontuação).
* Escala: 11 / 12 / 13 (base) / 14 / 16 / 20 / 28 px; `line-height` 1,4–1,5; rótulos em 11 px com caixa alta e
  *tracking* +0,06 em.
* Fontes embutidas via `@fontsource-variable` (offline, sem CDN).

## Espaçamento, raios e elevação

* Grade de 4 px: `2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48`.
* Raios: 6 (chips) · 10 (controles) · 14 (painéis) · 999 (pílulas).
* Elevação: bordas de 1 px + sombra suave (`0 4px 16px rgba(0,0,0,.28)`); popovers `0 12px 40px rgba(0,0,0,.45)`.
* Janela mínima: **960 × 620** (DIP; resiste a escala do Windows de 100–200 %).

## Linguagem de movimento

| Tipo | Duração | Curva | Propriedades |
|---|---|---|---|
| Microinteração (hover, foco, pressionar) | 140 ms | `cubic-bezier(.2,.7,.2,1)` | `transform`, `opacity`, cor |
| Entrada/saída de conteúdo | 220 ms | desaceleração / aceleração | `transform`, `opacity` |
| Expansão de detalhes | 220 ms | `cubic-bezier(.4,0,.2,1)` | altura (uma vez, por clique) |
| Reordenação das recomendações | 260 ms | `cubic-bezier(.4,0,.2,1)` | FLIP via `transform` |

* Sem molas/elasticidade. Sem animações contínuas (apenas um pulso lento e discreto no estado "ao vivo", desligado
  com movimento reduzido).
* **Movimento reduzido:** respeita `prefers-reduced-motion` *e* tem opção própria (Sistema / Reduzir / Completo).
* Atualizações de dados **nunca** remontam a lista: as linhas têm identidade (`championId`), apenas mudam de
  posição; a ordem só muda quando a diferença de pontuação supera uma histerese.

## Contraste (calculado, WCAG 2.1)

Verificado por `scripts/check-contrast.ts`; os pares usados para texto precisam de ≥ 4,5:1 (ver resultado no README).

## Plano de jogo (aba nova)

Mesmos tokens e **um só destaque** (verde-água): aba ativa, veredito favorável, objetivo da build, "Em uso" e botão
principal. Contraste e foco como no resto do app (axe: 0 violações). Decisões de layout:

* as abas "Recomendações | Plano de jogo" ficam presas ao topo e, no plano, **a página inteira rola** (o quadro do draft
  sai de cena) — o conteúdo é longo e o conteúdo útil não pode ficar numa faixa pequena em 960×620;
* três cartões de build (escolha tipo *radio*) mostram o núcleo de cada uma; o painel abaixo detalha a escolhida;
* cada linha da dica de confronto leva uma etiqueta de origem (dado / regra / oficial / terceiros) — o usuário vê o que é
  estatística e o que é regra;
* o resultado do envio ao cliente é uma lista por etapa (ok / pulada / falhou) em região `aria-live`.
