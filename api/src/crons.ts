// Expressões dos Cron Triggers. O handler `scheduled` compara o `controller.cron`
// com estas constantes, e um teste as compara com o `wrangler.toml`.

/**
 * Limite do plano Free da Cloudflare: 5 Cron Triggers por CONTA, somando todos
 * os Workers. Passar disso derruba o deploy com o erro 10072 ("This account has
 * reached the Workers Free limit of 5 cron triggers per account"), como no
 * Deploy API da PR #769.
 */
export const CLOUDFLARE_FREE_CRON_LIMIT = 5
/** Triggers que a conta já usa em outro Worker e que esta API não controla. */
export const CRONS_USED_BY_OTHER_WORKERS = 1
/** O que sobra para a API: 5 - 1 = 4 triggers, nem um a mais. */
export const MAX_API_CRON_TRIGGERS = CLOUDFLARE_FREE_CRON_LIMIT - CRONS_USED_BY_OTHER_WORKERS

/** Minutos UTC em que o cron fundido roda o result poller (ADR-007). */
export const RESULT_POLLER_MINUTES = [0, 30] as const
/**
 * Minutos UTC em que o cron fundido roda o drenador da fila durável de sync
 * (ADR-027). Ficam fora dos minutos do poller (que roda sozinho neles) e do 15
 * (descoberta), com 5 a 10 min entre ciclos.
 */
export const PROVIDER_WORK_DRAIN_MINUTES = [5, 10, 20, 25, 35, 40, 50, 55] as const

/**
 * Um único trigger para poller e drenador (ADR-027, adendo do erro 10072). O
 * handler escolhe a rotina pelo minuto UTC de `scheduledTime`: minutos 0 e 30
 * rodam só o poller; os demais, só o drenador. Isto precisa ser a união ordenada
 * de `RESULT_POLLER_MINUTES` e `PROVIDER_WORK_DRAIN_MINUTES` (um teste confere).
 */
export const POLLER_AND_DRAIN_CRON = '0,5,10,20,25,30,35,40,50,55 * * * *'

/**
 * Export diário: 00:05 UTC. O minuto 5 também é do drenador no trigger fundido,
 * então às 00:05 as duas rotinas disparam juntas em invocações independentes.
 * É inofensivo: o drenador é idempotente (o `UPDATE ... RETURNING` da fila nunca
 * entrega o mesmo item a dois drenos) e, sem pendência, custa 1–2 consultas ao D1.
 */
export const DAILY_EXPORT_CRON = '5 0 * * *'
/** Lembrete de jogos de hoje sem palpite. */
export const ROUND_REMINDER_CRON = '0 10 * * *'
/** Descoberta de jogos: 06:15 UTC (03:15 BRT), fora dos minutos do poller e do drenador. */
export const FIXTURE_DISCOVERY_CRON = '15 6 * * *'

export const SCHEDULED_CRONS = [
  POLLER_AND_DRAIN_CRON,
  DAILY_EXPORT_CRON,
  ROUND_REMINDER_CRON,
  FIXTURE_DISCOVERY_CRON,
]

/** O tick do cron fundido é do poller (minutos 0 e 30 UTC)? Senão, é do drenador. */
export function isResultPollerTick(scheduledTime: number): boolean {
  const minute = new Date(scheduledTime).getUTCMinutes()
  return (RESULT_POLLER_MINUTES as readonly number[]).includes(minute)
}
