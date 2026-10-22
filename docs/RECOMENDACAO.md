# Motor de recomendação

Determinístico, explicável e testado (`src/core/engine.ts`, 30+ testes em `tests/`). Não usa modelo de linguagem,
rede nem relógio escondido: a mesma entrada produz sempre a mesma saída.

> **Aviso honesto:** os pesos são valores iniciais escolhidos por julgamento e por medições pontuais. **Não foram
> calibrados contra resultados de partidas.** Estão todos em `src/core/config.ts`, com a origem de cada um.

## Unidade comum: "p.p. equivalentes"

Cada fator vale uma quantidade de pontos percentuais equivalentes (p.p.) de taxa de vitória. É só uma régua para
comparar fatores de natureza diferente; **não é a chance de vitória da composição** e a soma de taxas individuais
nunca é tratada como tal. A tela mostra uma "Adequação" de 0 a 100 = `100 / (1 + e^(−soma/3))`, com escala fixa:
a nota de um campeão não muda porque outro campeão entrou ou saiu da lista.

```
soma = estatística (base + confronto + sinergia) + composição + preferências
```

## 1. Evidências estatísticas (dados reais do OP.GG)

| Fator | Como é calculado | Por que assim |
|---|---|---|
| **Base** | taxa de vitória do campeão na rota, **encolhida** para a média da rota: `(vitórias + k·μ) / (partidas + k)`, `k = 1200` | Bayes empírico: `k = p(1−p)/τ²`. Medi τ ≈ 1,3 p.p. (dispersão real entre campeões com >3000 partidas na mesma rota, 22/10/2026) ⇒ k ≈ 1400. Amostras pequenas pesam pouco: 300 partidas → 20 % do peso observado |
| **Confronto de rota** | para cada inimigo `e` com probabilidade `q_e` de ser meu oponente de rota: `borda_e = m − pX`, onde `m` é a taxa do confronto encolhida (`k = 300`) **em direção a `0,5 + pX − pY`** (esperado pelas taxas individuais). Contribuição = `Σ q_e · borda_e` | Usa a força do campeão **uma vez**: o confronto *substitui* a base na proporção da sua amostra (não se somam). `k = 300` ⇒ τ ≈ 2,9 p.p. entre confrontos |
| **Sinergia** | para cada aliado confirmado com rota conhecida: `n/(n+600) · (taxa do par − esperado)`, `esperado = 0,5 + (pX−0,5) + (pA−0,5)` | Líquida das taxas individuais (mesmo princípio). Pares variam menos que confrontos (τ ≈ 2 p.p.) |

* **Posição inimiga incerta.** As posições de um time são tratadas como uma permutação; a probabilidade de cada
  atribuição é proporcional ao produto das frequências de rota (`role_rate`). A marginal `q_e` vem de enumerar as ≤120
  permutações (`src/core/positions.ts`). Se a posição foi informada (cliente ou manual), `q = 1`. Com `q < 75 %` a
  tela mostra o risco "Oponente de rota incerto (Yasuo: 21 %)" e o peso do confronto cai proporcionalmente.
* **Elo diferente do agregado das tabelas.** A base respeita o elo escolhido; confrontos e sinergias só existem no
  agregado padrão do OP.GG (≈ Emerald+, inferido). Se forem diferentes, esses dois fatores valem ×0,6 e a tela avisa.
* **Limites:** confronto ±6 p.p., sinergia ±3 p.p. (nenhum dado isolado domina).

## 2. Heurísticas de composição (sem estatísticas)

Medem **necessidades do time** (déficits) e o quanto o candidato as supre; só olham para aliados/inimigos já
escolhidos (seleções temporárias valem 0,5):

| Eixo | Déficit | Peso máx. (p.p.) |
|---|---|---|
| Dano físico × mágico | time com >60 % (ou <40 %) de um tipo; só conta dano de quem tem peso de dano | 1,2 |
| Linha de frente | soma de resistência < 1,5 (penaliza excesso > 2) | 1,5 |
| Engajamento | soma < 1 | 1,0 |
| Controle de grupo | soma < 1,5 | 0,8 |
| Proteção | só se há "carregador" aliado e pouca proteção; penaliza o candidato que precisa de proteção sem ter | 1,0 |
| Desengajar | inimigos com ≥ 1,5 de ameaça de mergulho e pouca proteção | 0,8 |
| Alcance | time quase todo corpo a corpo | 0,5 |

Para **não contar o mesmo sinal várias vezes** (um tanque é frente + engajamento + CC), a soma dos eixos é
**saturada**: `2,5 · tanh(soma / 2,5)`. O teto de 2,5 p.p. é propositalmente menor que um bom confronto: a evidência
estatística pesa mais que a heurística. A influência também é multiplicada por `min(1, aliados/4)`: com poucos
aliados ainda não há o que "corrigir".

Os traços (`src/core/data/traits.json`) são **derivados** de funções/atributos do Meraki Analytics (MIT) + Data
Dragon e **curados em parte** por mim (`scripts/trait-overrides.json`: engajamento, proteção, desengajar, mergulho).
Lançamentos novos sem dados usam um recuo neutro por tags. Revise o arquivo se discordar de algum campeão.

## 3. Preferências pessoais

| Situação | Contribuição (× peso 0,5/1/1,5 escolhido) |
|---|---|
| Na pool como Aprendendo / Confortável / Dominado / Especialista | −0,5 / +0,75 / +1,75 / +2,75 |
| Fora da pool (pool não vazia, sem restrição) | −1,0 |
| Sem pool, mas maestria do cliente (≥1,5k / 8k / 35k / 100k pontos) | nível inferido × 0,5 |
| Excluído / não possuo (posse lida do cliente) | removido da lista |
| "Só minha pool" | só pool (sem estatística ⇒ aparece como "dados insuficientes") |

A maestria **só** entra quando você não definiu a familiaridade — nunca as duas.

## 4. O que é (e o que não é) usado

| Sinal | Usado? | Observação |
|---|---|---|
| Taxa de vitória na rota (patch/elo) | ✅ base | uma vez |
| Confronto de rota | ✅ | substitui parte da base |
| Sinergia com aliados | ✅ | líquida das individuais |
| Taxa de escolha / taxa de ban | ❌ | só informativas; usá-las duplicaria a taxa de vitória |
| "Tier" do OP.GG | ❌ | é derivado de vitória/escolha/ban (duplicaria) |
| Composição inimiga (dano/CC) | parcial | só mergulho inimigo (desengajar) |
| Builds, runas, feitiços | ❌ no ranking | tratados no plano de jogo, depois da escolha ([BUILDS.md](BUILDS.md)) |

## 4b. "Por que está em 1º"

O destaque explica a posição do 1º comparando-o ao 2º fator a fator (mesmas contribuições da soma; diferenças < 0,3
p.p. ignoradas; empate dentro da histerese é dito como tal). Ver [BUILDS.md](BUILDS.md#1-por-que-o-campeão-está-no-topo-explain-rankts).

## 5. Candidatos e exclusões

1. Candidatos "gerais": campeões com ≥ 200 partidas e ≥ 5 % de frequência na rota; mais todos da pool.
2. Removidos: banidos e escolhidos **confirmados** (qualquer time), excluídos, não possuídos (se o cliente informou),
   fora da pool (se restrito). Seleção **temporária** de aliado **não** remove — vira aviso.
3. Ordenação com **histerese** (`src/core/rank.ts`): quem está a ≤ 0,6 ponto do primeiro de um grupo mantém a ordem
   anterior; a lista não se embaralha por oscilações pequenas.

## 6. Qualidade dos dados e recuos

* **Dados suficientes / parciais / insuficientes** por candidato (< 300 partidas ⇒ insuficiente; amostra baixa,
  confronto ausente ou rota atípica ⇒ parcial).
* **Sem estatísticas** (fonte fora do ar, sem cache): só aparece quem tem algum sinal positivo de composição ou pool;
  sem sinal nenhum, a lista fica vazia e a tela explica o problema (não se inventa uma lista).
* **Patch** diferente do jogo e **dados com > 36 h** geram avisos.

## 7. Limitações conhecidas

* Pesos não calibrados; tamanho dos efeitos é hipótese de trabalho.
* Sinergias do OP.GG vêm só dos 10 melhores parceiros por rota: parceiro ausente = "sem dado" (zero), não "ruim".
* A tabela de confrontos cobre ~54 oponentes (≈ 74 % das partidas de um campeão): oponentes raros ficam sem dado.
* O 2×2 da bot lane é aproximado por confrontos 1×1 (ADC×ADC, suporte×suporte).
* A região não filtra as estatísticas (o OP.GG não permite).
* `win_rate` por elo vem arredondado a 2 casas do servidor; as vitórias são reconstruídas.
