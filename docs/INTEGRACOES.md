# Integrações — o que foi verificado (22/10/2026)

Tudo abaixo foi conferido contra páginas oficiais ou chamadas reais feitas durante o
desenvolvimento. Onde não foi possível verificar, está escrito.

## Resumo

| Camada | Fonte | Oficial? | Chave | Estado |
|---|---|---|---|---|
| Dados estáticos e imagens | **Data Dragon** | Sim (Riot) | Não | Verificado ao vivo (patch 16.21.1, `pt_BR`, imagens) |
| Estatísticas agregadas (win/pick/ban, matchups, sinergias, patch) | **OP.GG MCP** (`https://mcp-api.op.gg/mcp`) | Endpoint público de terceiros (repositório MIT `opgginc/opgg-mcp`); **sem termos de uso nem limites publicados** | Não | Verificado ao vivo (handshake, 5 ferramentas, formato dos dados) |
| Estado do draft | **LCU** (cliente local, `127.0.0.1`) | **Não suportado oficialmente** pela Riot | Token local do cliente em execução | Esquema conferido nos tipos gerados do cliente 16.12; **não testado contra o cliente real** |
| Dados pessoais (campeões possuídos, maestria) | **LCU** | Idem | Idem | Idem |
| Atributos de campeões (tipo de dano, funções) | **Meraki Analytics** (`lolstaticdata`), usado apenas em *build time* | Não (comunidade) | Não | Verificado; gera `src/core/data/traits.json` |

## O que a Riot diz (fontes oficiais lidas)

* **Developer Portal – políticas gerais** (<https://developer.riotgames.com/policies/general>):
  produtos devem ser registrados e auditados; chave **não pode estar em binário distribuído**;
  exige o aviso *"isn't endorsed by Riot Games…"* (incluído em *Configurações → Sobre*);
  só os ativos listados (Data Dragon, press kit) podem ser usados como IP da Riot.
* **Documentação LoL** (<https://developer.riotgames.com/docs/lol>):
  * LCU: *"This service is not officially supported for use with third party applications."*
    Sem garantia de documentação, disponibilidade ou aviso de mudanças. A Riot pede que o uso
    seja **registrado no Developer Portal** (listar os endpoints usados).
  * Game Policy: *"Products must not use … information not present in the game client"* que dê vantagem;
    apps que *"dictate player decisions"* são **não aprovados**; produtos podem *"highlight decisions"* e
    oferecer várias opções; estatísticas agregadas (sem jogadores específicos) são exemplo aprovado.
  * Chaves: desenvolvimento (expira em 24 h), **pessoal** (20 req/s e 100 req/2 min; não pode ser usada
    publicamente) e produção (500 req/10 s; exige protótipo e aprovação).
* **Post de DevRel sobre LCU** (24/01/2019): exigir contato antes de publicar apps com LCU e uso apenas de
  endpoints aprovados. A lista aprovada atual **não é pública**; a página `league-client-apis` só pede registro.

### Consequências de design

1. O LeagueSense **apresenta até 5 opções com justificativa** e nunca escolhe, bane, trava campeão nem automatiza o draft
   (alinhado a "não ditar decisões" / "oferecer múltiplas opções"). A **única escrita** no cliente é a build (itens, runas e,
   opcionalmente, feitiços) que o jogador manda explicitamente com "Usar esta build".
2. Só usa o que o jogador já vê no cliente (picks/bans visíveis) e estatísticas agregadas públicas.
3. **Nenhuma chave Riot é usada na v1.** Se um dia for necessária (ex.: Match‑V5 para histórico pessoal),
   a menor solução segura é o usuário colar sua *chave pessoal* nas configurações e o app guardá‑la com
   `safeStorage` (nunca no bundle/instalador). Uma chave de produção exigiria um proxy no servidor.
4. **Atenção (plano de jogo):** orientar "objetivo" e "comportamento" por fase vai além de *destacar decisões*. O app
   oferece 3 opções, cita o fato por trás de cada orientação e diz que são regras, mas **a Riot pode entender isso como
   "ditar decisões"** em uma revisão do produto. Vale descrever o recurso com franqueza ao registrar o app e, se a
   Riot pedir, desligar essas seções. Itens/runas sugeridos só usam estatísticas agregadas públicas e informações do draft.
5. **Ação do usuário:** registrar o LeagueSense como produto pessoal no Developer Portal e anotar o uso do LCU
   (endpoints na seção abaixo). Isso não pode ser feito por mim.

## Data Dragon

* `https://ddragon.leagueoflegends.com/api/versions.json` → `16.21.1` (mais recente hoje).
* `.../cdn/{versão}/data/pt_BR/champion.json` → 173 campeões, nomes em pt‑BR, `key` numérica (= `championId` do LCU).
* **Catálogo de builds** (pt-BR): `.../cdn/{versão}/data/pt_BR/{item,runesReforged,summoner}.json` → nomes, etiquetas
  (`Armor`, `SpellBlock`, `Tenacity`…), custo, "Ferimento Grave" (detectado na descrição) e caminhos de ícones.
  Reduzido por `src/core/catalog.ts`; ao vivo → cache → cópia embutida (`src/core/data/catalog.json`, gerada por
  `npm run build:data`).
* **Dicas oficiais para enfrentar** cada campeão: `.../data/pt_BR/champion/{Chave}.json` → `enemytips`.
* Ícones de item, feitiço, estilo/runa e fragmento: `.../img/item|spell/{id}.png` e `.../cdn/img/perk-images/...`
  (verificados, todos 200).
* Imagens: `.../cdn/{versão}/img/champion/{id}.png` (ícone quadrado 120 px) e
  `.../cdn/img/champion/splash/{id}_0.jpg` / `loading/{id}_0.jpg`. O app as baixa sob demanda e guarda em disco
  (não embute imagens da Riot no instalador).

## OP.GG MCP

Transporte *Streamable HTTP* (JSON‑RPC por POST; cabeçalho `Mcp-Session-Id`). Sem autenticação.

Ferramentas usadas (todas verificadas):

| Ferramenta | Uso no app | Observações medidas |
|---|---|---|
| `lol_list_champions` | Mapa nome inglês → `championId` | 254 entradas; ignora as `Jade_*` (modo especial) |
| `lol_list_lane_meta_champions` (`position=all`) | Win/pick/ban, `play`/`win` exatos, `role_rate`, patch implícito | 1 chamada para as 5 rotas; **sem filtro de elo** |
| `lol_get_champion_analysis` (`tier=…`) | Base por elo; `trends.win[].version` = **patch** | `win_rate` vem **arredondado a 2 casas**; contagens `play` exatas |
| `lol_get_lane_matchup_guide` | **Tabela completa de matchups** (`data.counters[]` ≈ 54 oponentes com `play`/`win`) | JSON de ~50 KB; sem filtro de elo; ~2,5 s/chamada |
| `lol_get_champion_synergies` | Sinergia por par de rotas | **Só top 10** parceiros; sem filtro de elo |
| `lol_get_champion_analysis` (campos de build) | **Builds gerais**: núcleo, botas, iniciais, 4º–6º item, feitiços, runas, ordem de habilidades | aceita `tier`; `names` das listas gerais vêm como os próprios ids (os nomes vêm do Data Dragon) |
| `lol_get_lane_matchup_guide` (campos de build) | **Builds do confronto**, estilo, vantagens, vitórias por duração, dica | mesma chamada dos confrontos; dica **só em inglês** (`lang`: `en_US`/`ko_KR`) |

Pontos que importam:

* **Formato:** a maioria das respostas não é JSON, e sim um DSL (`class X: campos` + `X(valores…)`).
  `src/main/sources/opgg/dsl.ts` faz o parse com validação (zod) — formato verificado contra respostas reais.
* **Elo:** valores aceitos (erro de validação do servidor lista todos): `ALL, CHALLENGER, GRANDMASTER, MASTER_PLUS,
  MASTER, DIAMOND_PLUS, DIAMOND, EMERALD_PLUS, EMERALD, PLATINUM_PLUS, PLATINUM, GOLD_PLUS, GOLD, IBSG, SILVER,
  BRONZE, IRON`. Omitir `tier` **não** é "todos os elos": devolve o mesmo que `EMERALD_PLUS` (24.088 partidas para
  Ahri/mid nos dois casos; `ALL` dá 86.048). Matchups e sinergias **não aceitam `tier`**; pela coincidência de
  amostras, *infiro* que são Emerald+ (inferência, não documentação).
* **Patch:** vem de `trends.win[].version` (ex.: `16.21`). Durante a recomputação dos dados o servidor às vezes devolve
  `trends.win` vazio; o app trata isso como erro explícito (nunca guarda "sem patch" no cache) e tenta de novo.
* **Região:** **não existe parâmetro de região** para estatísticas de campeões. Os dados são um agregado global
  não especificado. A preferência de região é guardada e exibida, **mas não filtra estatísticas**.
* **Fila:** `game_mode=ranked` (Ranked Solo/Duo). Flex é `flex`.
* **Termos/limites:** nenhum encontrado (README, site). O app é conservador: ≤ 3 requisições simultâneas, cache em
  disco por patch, tolerância a falhas. **Risco:** o serviço pode mudar, limitar ou ser descontinuado.
  Recomendo confirmar os termos do OP.GG para o seu uso (pessoal).

## LCU (draft e dados pessoais)

Descoberta de credenciais (documentada pela comunidade — <https://hextechdocs.dev/getting-started-with-the-lcu-api/>):

* Processo `LeagueClientUx.exe`: argumentos `--app-port=` e `--remoting-auth-token=`; ou arquivo `lockfile`
  (`LeagueClient:PID:PORTA:SENHA:https`) na pasta de instalação.
* HTTP Basic `riot:<token>`; certificado autoassinado da Riot (validação: AC da Riot embutida, com fallback
  restrito a `127.0.0.1`).

Endpoints usados (nomes conferidos em `@hasagi/types@16.12.2`, gerado do cliente 16.12.785):

| Endpoint / evento | Uso |
|---|---|
| `GET /lol-gameflow/v1/gameflow-phase` | `None`, `Lobby`, `ChampSelect`, `InProgress`… |
| `GET /lol-champ-select/v1/session` + WS `OnJsonApiEvent_lol-champ-select_v1_session` | picks, bans, `localPlayerCellId`, `counter` |
| `GET /lol-champions/v1/owned-champions-minimal` | campeões possuídos (`ownership.owned`) |
| `GET /lol-champion-mastery/v1/local-player/champion-mastery` | maestria (usada só como estimativa inicial de familiaridade) |
| `GET /lol-summoner/v1/current-summoner` | `puuid` (exibição/diagnóstico) |

### Escrita no cliente (builds)

Usada só quando o jogador clica em **"Usar esta build"** (nunca sozinha, nunca em modo demonstração). Nomes conferidos nos
mesmos tipos gerados (`@hasagi/types@16.12.2`); **não testados contra o cliente real**:

| Endpoint | Uso |
|---|---|
| `GET /lol-summoner/v1/current-summoner` | `summonerId` / `accountId` do conjunto de itens |
| `GET`/`PUT /lol-item-sets/v1/item-sets/{summonerId}/sets` | lê tudo, troca só o conjunto "LeagueSense · Campeão · …" do mesmo campeão e devolve a lista inteira |
| `GET /lol-perks/v1/pages`, `GET /lol-perks/v1/inventory` | acha a página "LeagueSense …" e verifica se há espaço |
| `POST /lol-perks/v1/pages`, `PUT /lol-perks/v1/pages/{id}`, `PUT /lol-perks/v1/currentpage` | cria/atualiza a página própria e a seleciona |
| `DELETE /lol-perks/v1/pages/{id}` | **só** "Remover do cliente o que o LeagueSense criou", e só páginas "LeagueSense …" |
| `PATCH /lol-champ-select/v1/session/my-selection` | feitiços (opcional; só na seleção de campeões) |

Outras escritas são recusadas antes de sair do app. A Riot pede que **os endpoints do LCU usados sejam registrados** no
Developer Portal: inclua também estes de escrita. Detalhes e garantias em [BUILDS.md](BUILDS.md).

Limitação importante: o tipo de `actions[]` aparece como `unknown[]` no esquema gerado. O formato dos elementos
(`actorCellId`, `championId`, `completed`, `isInProgress`, `type`) é o conhecido pela comunidade e **não foi
confirmado contra um cliente real aqui**; o normalizador é tolerante (campos ausentes não quebram nada) e testado
contra um LCU falso que reproduz esse formato.

## Descartados

* **Riot API (Match‑V5, Champion‑Mastery‑V4):** não há estatística agregada; agregar seria inviável com 100 req/2 min.
  Maestria/posse já vêm do LCU sem chave.
* **u.gg, Lolalytics, MetaSRC:** sem API pública; extrair HTML/endpoints internos violaria termos/robots
  (Lolalytics declara `ai-train=no`; u.gg/MetaSRC responderam 403 ao acesso automatizado).
* **Community Dragon:** não é uma fonte de imagens permitida pela política da Riot (só Data Dragon/press kit).

## Verificação feita nesta entrega

| O quê | Como | Resultado |
|---|---|---|
| Handshake MCP, 5 ferramentas, formato dos dados | chamadas reais (`scripts/live-probe.ts`) | ok; lista por rota ≈ 5 s, demais ≈ 2,5–3 s |
| Nomes: todos os campeões do roster resolvem no OP.GG | `npm run check:data` (rede) | 173/173 ok, 0 falhas (22/10/2026) |
| Imagens (Data Dragon) pelo protocolo local | Electron real | ok (9+ imagens por tela) |
| Draft via LCU | **LCU falso** (HTTP/WS reais, protocolo da documentação) | ok; **cliente real não testado** |
| Builds e dica de confronto (OP.GG + Data Dragon) | chamadas reais, Electron real (`electron-smoke`) | ok (3 builds, ícones pelo protocolo local) |
| Envio da build ao cliente | **LCU falso** (PUT/POST/PATCH reais por HTTP) | ok; **cliente real não testado** |
| TLS do LCU | servidor com certificado autoassinado gerado por `openssl` | cai para loopback-only e sinaliza |
