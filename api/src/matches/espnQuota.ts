/**
 * Limites de concorrência das syncs ESPN no discovery e no poller.
 *
 * O cliente HTTP (`providers/espn.ts`) já serializa as requests com intervalo
 * mínimo entre inícios (~1,3s) para evitar 403 Akamai. Este teto limita o
 * trabalho paralelo de upsert/pontuação por competição no Worker quando há
 * até ~10 competições ESPN-primárias ativas ao mesmo tempo.
 */

/** Máximo de syncs ESPN em voo por ciclo (discovery ou poller). */
export const ESPN_MAX_CONCURRENT_COMPETITIONS = 2
