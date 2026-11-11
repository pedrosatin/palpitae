// Expressões dos Cron Triggers. O handler `scheduled` compara o `controller.cron`
// com estas constantes, e um teste as compara com o `wrangler.toml`.

/** Result poller: resultados da janela ativa e pontuação (ADR-007). */
export const RESULT_POLLER_CRON = '0,30 * * * *'
/** Cold path: exporta os eventos do dia anterior para o R2. */
export const DAILY_EXPORT_CRON = '5 0 * * *'
/** Lembrete de jogos de hoje sem palpite. */
export const ROUND_REMINDER_CRON = '0 10 * * *'
/** Descoberta de jogos: 06:15 UTC (03:15 BRT), fora dos minutos 0 e 30 do poller. */
export const FIXTURE_DISCOVERY_CRON = '15 6 * * *'

export const SCHEDULED_CRONS = [
  RESULT_POLLER_CRON,
  DAILY_EXPORT_CRON,
  ROUND_REMINDER_CRON,
  FIXTURE_DISCOVERY_CRON,
]
