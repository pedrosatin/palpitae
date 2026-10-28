import { useMemo } from 'react'
import { OTHER_COLOR, SERIES_COLORS } from './charts'
import { OverviewResponse, ArchiveResponse } from './types'

const MAX_CHART_TYPES = SERIES_COLORS.length

/** Últimos `days` dias UTC, do mais antigo pro mais novo (YYYY-MM-DD). */
export function lastDays(days: number, endOffset = 0): string[] {
  const today = new Date()
  const keys: string[] = []
  for (let back = days - 1 + endOffset; back >= endOffset; back--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back),
    )
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

/**
 * Monta as barras empilhadas: um segmento por tipo de evento por dia, tipos
 * ordenados por volume total, excedentes da paleta agrupados em "outros".
 * Dias sem evento entram zerados (buraco visível = dia sem tráfego).
 */
export function buildStackedSeries(
  daily: OverviewResponse['daily'],
  totals: OverviewResponse['totals'],
  days: number,
) {
  const ranked = totals.map((t) => t.event_type)
  const top = ranked.slice(0, MAX_CHART_TYPES)
  const colorFor = new Map(top.map((type, i) => [type, SERIES_COLORS[i]]))
  const hasOthers = ranked.length > top.length

  const byDay = new Map<string, Map<string, number>>()
  for (const row of daily) {
    const day = row.day.slice(0, 10) // "YYYY-MM-DD hh:mm:ss" → "YYYY-MM-DD"
    const type = colorFor.has(row.event_type) ? row.event_type : 'outros'
    const perType = byDay.get(day) ?? new Map<string, number>()
    perType.set(type, (perType.get(type) ?? 0) + Number(row.count))
    byDay.set(day, perType)
  }

  const order = hasOthers ? [...top, 'outros'] : top
  const series = lastDays(days).map((label) => {
    const perType = byDay.get(label)
    return {
      label,
      segments: order
        .map((type) => ({
          type,
          value: perType?.get(type) ?? 0,
          color: colorFor.get(type) ?? OTHER_COLOR,
        }))
        .filter((s) => s.value > 0),
    }
  })

  const legend = order.map((type) => ({
    type,
    color: colorFor.get(type) ?? OTHER_COLOR,
  }))
  return { series, legend }
}

export function buildApiCallsSeries(
  apiCallsDaily: OverviewResponse['apiCallsDaily'],
  days: number,
): { label: string; total: number }[] {
  const byDay = new Map(apiCallsDaily.map((r) => [r.day.slice(0, 10), Number(r.api_calls)]))
  return lastDays(days).map((label) => ({
    label,
    total: byDay.get(label) ?? 0,
  }))
}

/** DAU: usuários distintos palpitando por dia, alinhado à janela do período. */
export function buildDauSeries(
  predictionsDaily: OverviewResponse['predictionsDaily'],
  days: number,
): { label: string; total: number }[] {
  const byDay = new Map(predictionsDaily.map((r) => [r.day.slice(0, 10), Number(r.users)]))
  return lastDays(days).map((label) => ({
    label,
    total: byDay.get(label) ?? 0,
  }))
}

/**
 * Pulso dos crons: nome amigável + limite de "atrasado" (minutos). Última
 * execução além do limite pinta de vermelho — cron provavelmente parado.
 */
export const CRON_INFO: Record<string, { label: string; staleAfterMin: number }> = {
  poller_run: {
    label: 'Poller de resultados (a cada 30 min)',
    staleAfterMin: 45,
  },
  fixture_discovery_run: {
    label: 'Descoberta de jogos (diário)',
    staleAfterMin: 26 * 60,
  },
  cron_round_reminder: {
    label: 'Lembrete de rodada (diário)',
    staleAfterMin: 26 * 60,
  },
}

export function isStale(ts: string, staleAfterMin: number): boolean {
  const date = new Date(`${ts.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return false
  return Date.now() - date.getTime() > staleAfterMin * 60_000
}

export function useStackedSeries(overview: OverviewResponse | null) {
  return useMemo(
    () =>
      overview
        ? buildStackedSeries(overview.daily, overview.totals, overview.days)
        : { series: [], legend: [] },
    [overview],
  )
}

export function useApiCallsSeries(overview: OverviewResponse | null) {
  return useMemo(
    () => (overview ? buildApiCallsSeries(overview.apiCallsDaily, overview.days) : []),
    [overview],
  )
}

export function useDauSeries(overview: OverviewResponse | null) {
  return useMemo(
    () => (overview ? buildDauSeries(overview.predictionsDaily, overview.days) : []),
    [overview],
  )
}

export function useKpis(overview: OverviewResponse | null) {
  return useMemo(() => {
    if (!overview) return null
    const totalOf = (type: string) =>
      Number(overview.totals.find((t) => t.event_type === type)?.count ?? 0)
    const hits = Number(overview.cache.find((c) => c.result === 'hit')?.count ?? 0)
    const misses = Number(overview.cache.find((c) => c.result === 'miss')?.count ?? 0)
    const cacheTotal = hits + misses
    const groupsCreated = totalOf('group_created')
    const groupsJoined = totalOf('group_joined')
    return {
      activeUsers: Number(overview.predictions.active_users ?? 0),
      predictions: Number(overview.predictions.total ?? 0),
      groupsCreated,
      // Conversão de convite: entradas por grupo criado no período.
      joinRate: groupsCreated > 0 ? (groupsJoined / groupsCreated).toFixed(1) : '—',
      logins: totalOf('login_success'),
      cacheHitRate: cacheTotal > 0 ? `${Math.round((hits / cacheTotal) * 100)}%` : '—',
      emailUnsubs: totalOf('email_unsubscribed'),
      emailResubs: totalOf('email_resubscribed'),
    }
  }, [overview])
}

export function useWhaleShare(
  overview: OverviewResponse | null,
  kpis: { predictions: number } | null,
) {
  return useMemo(() => {
    if (!overview || !kpis || kpis.predictions === 0 || overview.whales.length === 0) return null
    const shareOf = (n: number) =>
      Math.min(
        100,
        Math.round(
          (overview.whales.slice(0, n).reduce((sum, w) => sum + Number(w.predictions), 0) /
            kpis.predictions) *
            100,
        ),
      )
    return { top1: shareOf(1), top5: shareOf(5) }
  }, [overview, kpis])
}

export function useAlerts(overview: OverviewResponse | null) {
  return useMemo(() => {
    if (!overview) return []
    const list: { key: string; label: string; level: 'warn' | 'danger' }[] = []

    for (const r of overview.lastRuns) {
      const info = CRON_INFO[r.event_type]
      if (info && isStale(r.last_run, info.staleAfterMin)) {
        list.push({
          key: `stale-${r.event_type}`,
          label: `${info.label} atrasado`,
          level: 'danger',
        })
      }
    }
    if (overview.recentErrors.length > 0) {
      list.push({
        key: 'errors',
        label: `${overview.recentErrors.length} erro(s) recente(s)`,
        level: 'danger',
      })
    }
    const emailFailed = Number(overview.emailHealth.failed)
    if (emailFailed > 0) {
      list.push({ key: 'email', label: `${emailFailed} falha(s) de e-mail`, level: 'danger' })
    }
    const loginFailTotal = overview.loginFailures.reduce((s, f) => s + Number(f.count), 0)
    if (loginFailTotal > 0) {
      list.push({ key: 'login', label: `${loginFailTotal} falha(s) de login`, level: 'warn' })
    }
    return list
  }, [overview])
}

export function useArchiveDays(archive: ArchiveResponse | null) {
  return useMemo(() => {
    if (!archive || archive.files.length === 0) return []
    const byDay = new Map(
      archive.files.map((f) => [f.key.replace('events/', '').replace('.ndjson', ''), f]),
    )
    const oldest = [...byDay.keys()].sort()[0].replaceAll('/', '-')
    return lastDays(14, 1)
      .reverse()
      .map((day) => {
        const key = day.replaceAll('-', '/')
        const file = byDay.get(key) ?? null
        return { day, file, beforeFirstExport: !file && day < oldest }
      })
  }, [archive])
}

export function useArchiveStats(archive: ArchiveResponse | null) {
  return useMemo(() => {
    if (!archive || archive.files.length === 0) return null
    const totalBytes = archive.files.reduce((sum, f) => sum + f.size, 0)
    const totalEvents = archive.files.reduce((sum, f) => sum + (f.events ?? 0), 0)
    const missingMeta = archive.files.filter((f) => f.events === null).length
    const oldestDay = archive.files
      .map((f) => f.key.replace('events/', '').replace('.ndjson', '').replaceAll('/', '-'))
      .sort()[0]

    const byMonth = new Map<string, number>()
    for (const f of archive.files) {
      const month = f.key.replace('events/', '').slice(0, 7).replace('/', '-') // YYYY-MM
      byMonth.set(month, (byMonth.get(month) ?? 0) + (f.events ?? 0))
    }
    const monthly = [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, total]) => ({ label, total }))

    return {
      totalDays: archive.files.length,
      totalBytes,
      totalEvents,
      missingMeta,
      oldestDay,
      monthly,
    }
  }, [archive])
}

export function useMetricsData(overview: OverviewResponse | null, archive: ArchiveResponse | null) {
  const stacked = useStackedSeries(overview)
  const apiCallsSeries = useApiCallsSeries(overview)
  const dauSeries = useDauSeries(overview)
  const kpis = useKpis(overview)

  // Sampling do AE: média > 1 significa amostragem — números viram estimativa.
  const avgSample = overview ? Number(overview.sampling.avg_sample_interval ?? 1) : 1
  const isSampling = avgSample > 1.01

  const whaleShare = useWhaleShare(overview, kpis)
  const alerts = useAlerts(overview)
  const archiveDays = useArchiveDays(archive)
  const archiveStats = useArchiveStats(archive)

  return {
    stacked,
    apiCallsSeries,
    dauSeries,
    kpis,
    avgSample,
    isSampling,
    whaleShare,
    alerts,
    archiveDays,
    archiveStats,
  }
}
