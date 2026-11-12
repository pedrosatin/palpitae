/** Limites compartilhados entre o poller primário e o resgate de resultados. */
export const EARLIEST_RESULT_MS = 115 * 60 * 1000
export const ACTIVE_RESULT_WINDOW_MS = 200 * 60 * 1000
export const RESCUE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Intervalo entre execuções do poller (`RESULT_POLLER_CRON`). */
export const POLLER_TICK_MS = 30 * 60 * 1000

/**
 * Varredura de atrasados: jogos sem resultado que saíram da janela ativa (adiados)
 * ou do resgate de 24 h (os demais) continuam sendo consultados até 7 dias depois
 * do último horário conhecido, a cada 3 h, uma rodada (football-data) ou um dia
 * (ESPN) por vez.
 */
export const LATE_SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const LATE_SWEEP_INTERVAL_MS = 3 * 60 * 60 * 1000
