# Plano de jogo: escolha do campeão, dica de confronto, builds e envio ao cliente

Esta parte do app **não muda o ranking** das recomendações: ela responde "e agora que eu vou jogar com este
campeão, o que faço?". Código em `src/core/{builds,matchup-advice,teams,focus,explain-rank}.ts` (puro e testado) e
`src/main/{build-service,lcu/build-writer}.ts` (integrações).

## 1. Por que o campeão está no topo (`explain-rank.ts`)

O bloco "Por que está em 1º" compara o 1º ao 2º **fator a fator**, usando exatamente as contribuições (p.p.) que o
motor somou — nenhuma justificativa nova é inventada. Diferenças menores que 0,3 p.p. são ignoradas. O texto traz até
3 vantagens do 1º, até 2 pontos em que o 2º leva vantagem e, se a diferença de pontuação for menor que a histerese
(0,6), diz que os dois estão praticamente empatados e que a ordem anterior foi mantida.

## 2. Escolher o campeão pelo app (`focus.ts`)

"Escolher e ver plano de jogo" (no destaque ou na linha expandida) e "Trocar campeão" (na aba Plano de jogo) definem
`myPick`. É uma escolha **só dentro do LeagueSense**: nada é selecionado nem travado no cliente do jogo.
O campeão em foco segue esta precedência:

1. o que você **travou no cliente** (verdade do jogo; se difere da escolha do app, um aviso explica);
2. o que você **escolheu no app**, se ainda estiver disponível (banido ou escolhido por outro ⇒ ignorado, com aviso);
3. o seu **provisório** no cliente;
4. a **melhor recomendação**.

A escolha é descartada ao começar outro draft, ao trocar de modo e ao limpar o draft manual.

## 3. Dica de confronto (`matchup-advice.ts`)

Oponente = o inimigo com maior probabilidade de ser da sua rota (mesma inferência de posições do motor). A incerteza
é mostrada quando a probabilidade é < 75 %. Cada linha diz **de onde vem**:

| Tipo | Origem | Exemplo |
|---|---|---|
| dado | taxa de vitória do confronto (OP.GG), com ajuste bayesiano k = 300; < 50 partidas ⇒ "sem veredito" | "Ahri vence 49,6 % contra Zed (852 jogos; 49,7 % ajustado)" |
| dado | indicações do OP.GG: estilo (agressivo/defensivo), vantagem na rota, abates 1×1, vitórias por duração | "Zed tem vantagem em abates 1x1…" |
| regra | traços dos campeões (alcance, mobilidade, CC, cura, resistência) — heurísticas do LeagueSense | "Você ataca à distância e Zed é corpo a corpo…" |
| oficial | dicas da Riot em pt-BR (`enemytips` do Data Dragon), até 3 | "Dicas oficiais da Riot contra Zed" |
| terceiros | dica do OP.GG, **em inglês** (o serviço só oferece `en_US`/`ko_KR`); não é traduzida para não adulterar | marcada "não traduzida" |

Veredito: favorável (≥ 51,5 % ajustado), desfavorável (≤ 48,5 %), equilibrado, ou sem dados.

## 4. As três builds (`builds.ts`)

Os **itens vêm sempre de dados reais** do OP.GG (só se escolhe entre o que jogadores realmente compraram, no elo
escolhido); a adaptação aos times usa **regras sobre as etiquetas dos itens** (Data Dragon) e os traços dos campeões.

| Build | Núcleo (3 itens) | Demais itens | Peso da adaptação (λ) |
|---|---|---|---|
| **Meta geral** | o conjunto mais jogado do campeão na rota | os mais escolhidos nas posições 4–6 | 1 |
| **Meta no confronto** | o de melhor taxa de vitória *neste confronto* (≥ 20 partidas, diferente do da build 1) | idem, mas das listas do confronto | 0,6 |
| **Adaptada aos times** | entre os núcleos reais, o de melhor `vantagem + popularidade + λ·encaixe` | idem | 1,5 |

Pontuação de um candidato: `min(3, vantagem de vitória em p.p., após prior k = 60) + 15·taxa de escolha + λ·3·encaixe`.
A vantagem é **limitada** (3 p.p.) e a popularidade pesa bastante porque a taxa de vitória de itens tardios é
enviesada (quem já está ganhando compra mais itens — itens de "bola de neve" apareceriam sempre no topo).

**Necessidades** (todas com limiares e fato citado; nenhuma é calibrada):

| Necessidade | Quando | Itens que atendem |
|---|---|---|
| Armadura / Resistência mágica | > 50 % do dano inimigo é físico / mágico (rampa até 80 %) | etiqueta `Armor` / `SpellBlock` |
| Penetração (do tipo certo) | inimigos com muita linha de frente | `ArmorPenetration` (dano físico) ou `MagicPenetration` |
| Tenacidade | muito controle de grupo inimigo | `Tenacity` |
| Sobrevivência | inimigos com mergulho e você é frágil, ou time sem proteção para um carregador | vida/armadura/resistência (mais se for ativo) |
| Redução de cura | inimigos que se curam | item com Ferimento Grave (detectado na descrição do Data Dragon) |

Feitiços: os mais usados nos dados; na build adaptada, Purificar contra muito CC e Exaustão/Barreira contra mergulho
(só se houver essa opção nos dados). Runas e ordem de habilidades vêm do OP.GG (geral ou do confronto).
Se o guia do confronto não existir, saem 2 builds e um aviso; sem catálogo, nomes em inglês e sem adaptação por tipo.

## 5. Objetivo e comportamento

São **orientações geradas por regras** (heurísticas), não estatística de vitória, e a tela diz isso. Entram: o
arquétipo (função principal do Data Dragon, com os traços como alternativa), o perfil dos dois times (dano,
resistência, CC, mergulho, cura, engajamento, proteção) e, quando há, o confronto (estilo, vitórias por duração).
Cada orientação específica traz o **"Por quê"** (o fato que a motivou). Fases: rota, meio de jogo, lutas de equipe.

## 6. Enviar a build ao cliente ("arsenal" no jogo)

"Usar esta build" marca a build como em uso e, com o cliente conectado, grava no cliente (`src/main/lcu/build-writer.ts`):

| O quê | Como | Observação |
|---|---|---|
| **Conjunto de itens** "LeagueSense · Campeão · Build" | `GET/PUT /lol-item-sets/v1/item-sets/{summonerId}/sets` | blocos: Iniciais, Botas, Itens principais, Situacionais, Visão (3340 e 2055); aparece na loja, em "Conjuntos de itens" |
| **Página de runas** "LeagueSense Campeão" | `GET/POST/PUT /lol-perks/v1/pages`, `PUT /lol-perks/v1/currentpage` | usa 1 espaço; reenviar atualiza no lugar |
| **Feitiços** (opcional, desligado por padrão) | `PATCH /lol-champ-select/v1/session/my-selection` | só na seleção de campeões; Flash fica na 2ª posição |

Garantias (testadas contra um LCU falso com HTTP real):

* só toca em itens/páginas cujo nome começa com **"LeagueSense"**; conjuntos e páginas do jogador são preservados e
  **nunca apagados** (se não há espaço para a página, a etapa falha com explicação);
* lista fechada de escritas (`isWriteAllowed`): nenhum outro caminho/método sai do app — em particular **nada de
  escolher, banir, aceitar partida ou mexer no lobby**;
* cada etapa é independente e o resultado por etapa (ok / pulada / falhou, com motivo) aparece na tela;
* em **modo demonstração nada é enviado** (os dados são fictícios);
* "Remover do cliente o que o LeagueSense criou" (Configurações → Preferências) apaga só o nosso.

**Limitação importante:** o formato dos recursos segue os tipos gerados do cliente 16.12 e a documentação da
comunidade; **não foi testado contra o cliente real**. A interface local (LCU) não tem suporte oficial da Riot — o uso
precisa ser registrado no Developer Portal (veja `INTEGRACOES.md`).

## 7. Limitações

* Objetivo/comportamento e necessidades de itens são regras, com limiares não calibrados.
* Taxas de vitória de itens por confronto vêm de amostras pequenas (o app mostra o tamanho e avisa).
* O oponente de rota é uma inferência (a UI mostra a probabilidade); a dica do OP.GG está em inglês.
* Builds e confrontos dependem de rede (OP.GG) na primeira consulta; depois ficam em cache (builds 6 h, confrontos 12 h).
  O catálogo de itens cai para uma cópia embutida (patch da data do build) se o Data Dragon estiver fora.
* O guia de confronto não aceita filtro de elo (agregado inferido como Emerald+).
