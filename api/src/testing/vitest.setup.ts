import { setFootballDataRateLimitForTests } from '../matches/providerBudget'

/**
 * Fluxos de teste sincronizam muitas competições no mesmo minuto, muitas vezes
 * seguidas; o teto do orçamento compartilhado de chamadas (ADR-027) não é o
 * que eles exercem. Sobe o teto para toda a suíte; os testes do orçamento
 * (`providerBudget.test.ts`, `providerWork.test.ts`, coordenação) fixam o
 * valor que precisam.
 */
setFootballDataRateLimitForTests(1000)
