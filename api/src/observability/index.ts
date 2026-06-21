export * from './events'

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

export function logRequestPerf(route: string, metrics: RequestPerfMetrics) {
  const payload = {
    route,
    status: metrics.status,
    total_ms: roundMs(metrics.totalMs),
    ...(metrics.dbMs !== undefined ? { db_ms: roundMs(metrics.dbMs) } : {}),
    ...(metrics.rows !== undefined ? { rows: metrics.rows } : {}),
    ...(metrics.extra ?? {}),
  }

  console.info('[perf]', JSON.stringify(payload))
}
