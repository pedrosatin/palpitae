export * from './events'

import { logEvent } from './events'

type RequestPerfMetrics = {
  status: number
  totalMs: number
  dbMs?: number
  rows?: number
  extra?: Record<string, string | number | boolean | null | undefined>
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Latência de um request: log estruturado (Workers Logs, pro tail em tempo real)
 * + evento no Analytics Engine (agregação/dashboard). O AE só recebe as medidas
 * de baixa cardinalidade (rota, status, ms, rows) — `extra` varia demais pra ser
 * dimensão. Esquema posicional em `docs/observability.md` (`request_perf`).
 */
export function logRequestPerf(
  ae: AnalyticsEngineDataset | undefined,
  route: string,
  metrics: RequestPerfMetrics,
) {
  const payload = {
    route,
    status: metrics.status,
    total_ms: roundMs(metrics.totalMs),
    ...(metrics.dbMs !== undefined ? { db_ms: roundMs(metrics.dbMs) } : {}),
    ...(metrics.rows !== undefined ? { rows: metrics.rows } : {}),
    ...metrics.extra,
  }

  console.info('[perf]', JSON.stringify(payload))

  logEvent(ae, 'request_perf', {
    blobs: [route, String(metrics.status)],
    doubles: [roundMs(metrics.totalMs), roundMs(metrics.dbMs ?? 0), metrics.rows ?? 0],
  })
}
