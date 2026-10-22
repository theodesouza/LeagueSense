# Arquitetura

## Stack e por quê

**Electron + React + TypeScript + Vite (electron-vite) + electron-builder.**

* O acesso ao cliente do LoL exige HTTPS local com certificado autoassinado, WebSocket e leitura de processos/arquivos —
  tarefas naturais de um processo Node. Tauri/Rust obrigaria a reimplementar isso e a manter dois ecossistemas.
* O acabamento visual (camadas, tipografia variável, animações por `transform`/`opacity`, FLIP) é direto em
  Chromium; React + CSS puro, sem framework de UI.
* `electron-builder` gera instalador NSIS, versão portátil e `.zip` para Windows.
* Custo: instalador grande (~150 MB). Aceito em troca de simplicidade e de um único idioma (TypeScript) do início ao fim.

Dependências de execução: `ws` e `zod` (o resto é empacotado pelo Vite). Nenhuma infraestrutura, banco ou servidor.

## Processos e camadas

```
┌──────────────────────────── processo principal (Node) ────────────────────────────┐
│ integrações            núcleo puro (src/core)                 persistência           │
│  Data Dragon ─┐        draft · posições · engine · rank        settings.json (zod)   │
│  OP.GG MCP ───┼─► StatsService (cache, dedupe, versões)        cache/ (JSON em disco)│
│  LCU ─────────┘   LcuTracker (reconexão, época, contador)      images/ (Data Dragon) │
└───────────────▲──────────────── IPC validado (contextBridge) ─────────────────────┘
                │
┌───────────────┴──────────── renderer (sandbox, sem Node) ─────────────────────────┐
│ estado (reducer) → motor de recomendação (puro) → componentes React               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

| Pasta | Responsabilidade | Depende de |
|---|---|---|
| `src/core` | tipos, draft, inferência de posições, estatística, composição, motor, ordenação, plano de busca | nada (TS puro) |
| `src/main` | fontes externas, cache, serviço de estatísticas, LCU, preferências, janela, IPC | core, shared, Node/Electron |
| `src/shared` | contrato IPC (`api.ts`), canais, sincronização de estatísticas | core |
| `src/preload` | `contextBridge` (única superfície exposta ao renderer) | shared |
| `src/renderer` | estado, hooks, componentes, estilos | core, shared (nunca Node) |

O renderer roda o motor (síncrono, < 5 ms); o processo principal só busca/guarda dados e entrega **instantâneos**.

## Fluxo de dados

1. **Roster** (Data Dragon `pt_BR` + `en_US`) → ao vivo → cache → lista embutida (offline).
2. O renderer calcula um **plano de busca** (`planFetches`): candidatos prováveis + posições dos aliados confirmados.
3. `StatsService.request(plano)`: lista por rota (1 chamada) → patch → tabelas de confronto/sinergia, por candidato, em
   ordem de prioridade, ≤ 3 em paralelo, com atualizações parciais (≤ 4/s). Falha de um item não derruba os demais.
4. O motor recebe `(draft, posição, instantâneo, preferências, jogador)` e devolve até 5 recomendações + avisos.

## Proteções contra dados antigos / fora de ordem

| Risco | Proteção | Teste |
|---|---|---|
| Resposta de estatística de outra posição/elo/modo | cada instantâneo tem `contextKey` + `version`; a UI ignora outro contexto ou versão ≤ à aceita (`applyStatsUpdate`) | `stats-service.test.ts` |
| Resultados guardados por requisição | são guardados por **chave de dado** (patch/posição/campeão), nunca "por requisição" | idem |
| Requisição substituída | itens não iniciados são descartados (`generation`) | idem |
| Evento antigo do cliente | contador monotônico da sessão; resposta REST com `seq` menor que o aplicado é descartada | `lcu.test.ts` |
| Sessão atrasada de draft já encerrado | épocas encerradas ficam "aposentadas" | `lcu.test.ts` |
| Sair do draft / novo draft | época nova zera contador, dicas, detalhes abertos; sair do `ChampSelect` limpa tudo | `lcu.test.ts`, `verify-visual.ts` |

## Segurança

* `contextIsolation`, `sandbox`, sem `nodeIntegration`; navegação externa bloqueada; links externos só de uma lista
  fixa de hosts; CSP restritiva no `index.html` de produção (`connect-src 'none'`: o renderer não faz rede).
* IPC: remetente validado (origem confiável) e entradas validadas com zod (plano de busca).
* **Nenhum segredo** no código, no instalador ou em log. O app não usa chaves. O token do LCU fica só em memória e nunca é registrado.
* LCU: TLS validado contra a CA pública da Riot (embutida); se a cadeia não confere, cai para "loopback inseguro"
  **somente `127.0.0.1`** e sinaliza em *Configurações → Dados*. O token Basic continua exigido.
* Respostas externas são validadas (zod) antes de entrar no núcleo; formatos inesperados viram erros explicados.
* Imagens: protocolo `leaguesense-img://` com chave/versão validadas (sem *path traversal*), baixadas do Data Dragon e
  guardadas em `userData/images` — nada da Riot vai no instalador.

## Testes (Vitest, `npm test`)

`engine` (exclusões, draft incompleto, pool, amostras, falha de fonte, posições ambíguas, procedência, determinismo),
`positions/rank/draft`, `dsl/provider` (formato real do OP.GG), `stats-service` (falhas, cache, fora de ordem,
substituição), `http/mcp/ddragon/image/cache`, `lcu` (normalização, rastreador, **HTTP/WebSocket reais contra um LCU
falso**, TLS com certificado de teste). Mais: `verify-visual` (navegador), `verify-a11y` (axe), `electron-smoke`
(Electron real), `verify-package`, `check-live-data` (rede).
