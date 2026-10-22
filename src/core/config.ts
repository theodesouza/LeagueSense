/**
 * Pesos e limiares do motor de recomendação. TODOS são valores iniciais escolhidos por
 * julgamento e por medições pontuais (não foram ajustados contra resultados de partidas).
 * Cada constante diz de onde vem; docs/RECOMENDACAO.md explica o conjunto.
 *
 * Unidade comum: "pp" = pontos percentuais equivalentes de taxa de vitória. É uma régua de
 * comparação entre fatores, NÃO uma previsão de vitória.
 */
export const CONFIG = {
  shrinkage: {
    /**
     * Empirical Bayes: k = p(1-p)/τ². Medido em 22/10/2026 nas listas de rota do OP.GG
     * (campeões com >3000 partidas): desvio real entre campeões τ ≈ 1,3 pp → k ≈ 1400.
     * Usamos 1200 (um pouco menos conservador).
     */
    base: 1200,
    /** τ ≈ 2,9 pp de variação real entre confrontos → k ≈ 300. */
    matchup: 300,
    /** Pares aliados variam menos que confrontos (τ ≈ 2 pp) → k ≈ 600. */
    synergy: 600
  },
  /** Mínimo de partidas na rota para um campeão entrar como candidato "geral". */
  minPlayCandidate: 200,
  /** Frequência mínima na rota (role_rate) para candidato "geral". */
  minRoleRate: 0.05,
  /** Abaixo disto a estatística base é marcada como "amostra pequena". */
  lowSampleBase: 1000,
  /** Abaixo disto não há dado suficiente para a estatística base. */
  insufficientBase: 300,
  lowSampleMatchup: 100,

  /** Peso das tabelas de matchup/sinergia quando o elo escolhido difere do agregado delas. */
  mixedTierFactor: 0.6,

  caps: {
    lanePp: 6,
    synergyPp: 3,
    compositionPp: 2.5
  },

  /** Limiar de probabilidade para tratar a posição de um aliado como conhecida nas sinergias. */
  allyPositionMinProbability: 0.5,
  /** Piso de probabilidade de posição ao inferir (evita zerar campeões atípicos). */
  rolePriorFloor: 0.02,
  /** Peso de seleções temporárias (hover) em composição/sinergia/matchup. */
  hoverWeight: 0.5,

  /** Contribuição máxima de cada eixo de composição (pp), antes da saturação conjunta. */
  compositionAxisPp: {
    damage: 1.2,
    frontline: 1.5,
    engage: 1.0,
    cc: 0.8,
    peel: 1.0,
    disengage: 0.8,
    range: 0.5
  },
  /** Metas por eixo (somas de traços dos aliados). */
  compositionTargets: { frontline: 1.5, engage: 1, cc: 1.5, peel: 1, disengage: 0.8 },
  /** Quantos aliados (ponderados) tornam a composição "conhecida" por completo. */
  compositionFullInfoAllies: 4,

  personal: {
    /** Familiaridade explícita da pool (pp por nível). */
    familiarityPp: { 1: -0.5, 2: 0.75, 3: 1.75, 4: 2.75 } as Record<1 | 2 | 3 | 4, number>,
    /** Fora da pool, quando a pool existe e não está restrita. */
    outsidePoolPp: -1,
    /** Nível inferido da maestria (pontos) quando o usuário não definiu. */
    masteryLevels: [
      { min: 100_000, level: 4 },
      { min: 35_000, level: 3 },
      { min: 8_000, level: 2 },
      { min: 1_500, level: 1 }
    ] as { min: number; level: 1 | 2 | 3 | 4 }[],
    /** Estimativa por maestria vale menos que a escolha explícita. */
    inferredWeight: 0.5
  },

  /** adequação = 100/(1+e^(-total/scale)). Escala fixa → pontuações estáveis entre atualizações. */
  adequacyScalePp: 3,
  /** Histerese da ordenação (pontos de adequação). */
  rankHysteresis: 0.6,

  display: { maxItems: 5 },
  /** Dados mais antigos que isto são considerados defasados. */
  staleAfterMs: 36 * 60 * 60 * 1000
} as const
