/** Datas da janela diária da descoberta ESPN, de ontem a hoje + 7. */
export const ESPN_DISCOVERY_DATE_COUNT = 9

/** Limites compartilhados entre o poller primário e o resgate de resultados. */
export const EARLIEST_RESULT_MS = 115 * 60 * 1000
export const ACTIVE_RESULT_WINDOW_MS = 200 * 60 * 1000
export const RESCUE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Intervalo entre execuções do poller (minutos 0 e 30 do `POLLER_AND_DRAIN_CRON`). */
export const POLLER_TICK_MS = 30 * 60 * 1000

/**
 * Varredura de atrasados: jogos sem resultado que saíram da janela ativa (adiados)
 * ou do resgate de 24 h (os demais) continuam sendo consultados até 7 dias depois
 * do último horário conhecido, a cada 3 h, uma rodada (football-data) ou um dia
 * (ESPN) por vez.
 */
export const LATE_SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const LATE_SWEEP_INTERVAL_MS = 3 * 60 * 60 * 1000

export const DAY_MS = 24 * 60 * 60 * 1000

export type ResultWindowBounds = {
  /** Jogos que começaram há pelo menos `EARLIEST_RESULT_MS`. */
  earliestOver: string
  /** Jogos que começaram há no máximo `ACTIVE_RESULT_WINDOW_MS`. */
  stillRelevant: string
  /** Jogos que começaram há no máximo `RESCUE_WINDOW_MS`. */
  rescueFloor: string
  /** Jogos que começaram há no máximo `LATE_SWEEP_WINDOW_MS`. */
  lateFloor: string
}

/**
 * Limites de `start_time` da janela de resultado, os mesmos no poller e no fallback
 * da ESPN. `start_time` é gravado em ISO 8601 com `T`/`Z` (ex.: "2026-06-16T22:00:00Z"),
 * e os limites saem no mesmo formato para a comparação TEXT seguir lexicográfica.
 * O `datetime('now', ...)` do SQLite devolve "2026-06-16 23:21:20" (espaço, sem `Z`)
 * e compararia errado contra esse formato.
 */
export function resultWindowBounds(now: number): ResultWindowBounds {
  const before = (ms: number) => new Date(now - ms).toISOString()
  return {
    earliestOver: before(EARLIEST_RESULT_MS),
    stillRelevant: before(ACTIVE_RESULT_WINDOW_MS),
    rescueFloor: before(RESCUE_WINDOW_MS),
    lateFloor: before(LATE_SWEEP_WINDOW_MS),
  }
}

/** Data do scoreboard ESPN (`YYYYMMDD`) do instante em UTC. */
export function espnDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replaceAll('-', '')
}

/**
 * Datas do scoreboard ESPN a partir de um dia UTC (meia-noite em ms): `count` dias
 * consecutivos, o primeiro `from` dias depois dele (negativo para dias anteriores).
 * A ESPN indexa o dia local, e um jogo após meia-noite UTC pode estar no dia anterior.
 */
export function espnDatesAround(utcDay: number, from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => espnDate(utcDay + (from + i) * DAY_MS))
}
