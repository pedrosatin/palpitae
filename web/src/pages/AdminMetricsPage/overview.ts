import { OTHER_COLOR, SERIES_COLORS } from './charts'
import { lastDays } from './dates'
import { parseSqlUtc } from './format'
import { evaluateLoginFailureAlert } from './loginFailureAlert'
import { totalHttpFailures, type OpsResponse } from './ProviderOpsSection'
import type { ArchiveFile, BusinessResponse, MetricsAlert, OverviewResponse } from './types'

const MAX_CHART_TYPES = SERIES_COLORS.length

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
    const day = row.day.slice(0, 10)
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

/** Valor por dia alinhado à janela do período; dia sem linha entra zerado. */
export function dailyTotals<T extends { day: string }>(
  rows: T[],
  valueOf: (row: T) => number,
  days: number,
): { label: string; total: number }[] {
  const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), valueOf(r)]))
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
  const time = parseSqlUtc(ts)
  if (Number.isNaN(time)) return false
  return Date.now() - time > staleAfterMin * 60_000
}

function totalOf(overview: OverviewResponse, type: string): number {
  return Number(overview.totals.find((t) => t.event_type === type)?.count ?? 0)
}

export function buildKpis(overview: OverviewResponse) {
  const hits = Number(overview.cache.find((c) => c.result === 'hit')?.count ?? 0)
  const misses = Number(overview.cache.find((c) => c.result === 'miss')?.count ?? 0)
  const cacheTotal = hits + misses
  const groupsCreated = totalOf(overview, 'group_created')
  const groupsJoined = totalOf(overview, 'group_joined')
  return {
    activeUsers: Number(overview.predictions.active_users ?? 0),
    predictions: Number(overview.predictions.total ?? 0),
    groupsCreated,
    joinRate: groupsCreated > 0 ? (groupsJoined / groupsCreated).toFixed(1) : '—',
    logins: totalOf(overview, 'login_success'),
    cacheHitRate: cacheTotal > 0 ? `${Math.round((hits / cacheTotal) * 100)}%` : '—',
    emailUnsubs: totalOf(overview, 'email_unsubscribed'),
    emailResubs: totalOf(overview, 'email_resubscribed'),
  }
}

export function buildWhaleShare(overview: OverviewResponse, totalPredictions: number) {
  if (totalPredictions === 0 || overview.whales.length === 0) return null
  const shareOf = (n: number) =>
    Math.min(
      100,
      Math.round(
        (overview.whales.slice(0, n).reduce((sum, w) => sum + Number(w.predictions), 0) /
          totalPredictions) *
          100,
      ),
    )
  return { top1: shareOf(1), top5: shareOf(5) }
}

const RECENT_ERROR_INSPECTION_ONLY = new Set(['login_failure', 'oauth_error'])

export function buildAlerts(
  overview: OverviewResponse,
  ops: OpsResponse | null,
  business?: BusinessResponse | null,
): MetricsAlert[] {
  const list: MetricsAlert[] = []

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
  const actionableRecentErrors = overview.recentErrors.filter(
    (e) => !RECENT_ERROR_INSPECTION_ONLY.has(e.event_type),
  )
  if (actionableRecentErrors.length > 0) {
    list.push({
      key: 'errors',
      label: `${actionableRecentErrors.length} erro(s) recente(s)`,
      level: 'danger',
    })
  }
  const httpFailures = totalHttpFailures(ops)
  if (httpFailures > 0) {
    list.push({
      key: 'provider-http',
      label: `${httpFailures} falha(s) HTTP de provedor`,
      level: 'warn',
    })
  }
  const overdueTotal =
    business?.overdueTotal ??
    business?.competitions?.reduce((s, c) => s + Number(c.overdue_no_score ?? 0), 0) ??
    0
  if (overdueTotal > 0) {
    const hours = business?.overdueResultHours ?? 3
    list.push({
      key: 'result-overdue',
      label: `${overdueTotal} resultado(s) atrasado(s) (+${hours}h)`,
      level: 'warn',
    })
  }
  if (ops?.pendingWorkError) {
    list.push({
      key: 'provider-work',
      label: 'fila de provedores indisponível',
      level: 'warn',
    })
  } else {
    const pendingWork = ops?.pendingWork?.reduce((s, r) => s + Number(r.items ?? 0), 0) ?? 0
    if (pendingWork > 0) {
      list.push({
        key: 'provider-work',
        label: `${pendingWork} item(ns) na fila de provedores`,
        level: 'warn',
      })
    }
  }
  const emailFailed = Number(overview.emailHealth.failed)
  if (emailFailed > 0) {
    list.push({ key: 'email', label: `${emailFailed} falha(s) de e-mail`, level: 'danger' })
  }
  const loginSuccess = totalOf(overview, 'login_success')
  const loginFailTotal = overview.loginFailures.reduce((s, f) => s + Number(f.count), 0)
  const loginAlert = evaluateLoginFailureAlert({
    loginSuccess,
    loginFailures: loginFailTotal,
    avgSampleInterval: Number(overview.sampling.avg_sample_interval ?? 1),
  })
  if (loginAlert) {
    list.push({ key: 'login', label: loginAlert.label, level: 'warn' })
  }
  return list
}

function archiveDay(key: string): string {
  return key.replace('events/', '').replace('.ndjson', '')
}

export function buildArchiveDays(files: ArchiveFile[]) {
  const byDay = new Map(files.map((f) => [archiveDay(f.key), f]))
  const oldest = [...byDay.keys()].sort()[0].replaceAll('/', '-')
  return lastDays(14, 1)
    .reverse()
    .map((day) => {
      const key = day.replaceAll('-', '/')
      const file = byDay.get(key) ?? null
      return { day, file, beforeFirstExport: !file && day < oldest }
    })
}

export function buildArchiveStats(files: ArchiveFile[]) {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const totalEvents = files.reduce((sum, f) => sum + (f.events ?? 0), 0)
  const missingMeta = files.filter((f) => f.events === null).length
  const oldestDay = files.map((f) => archiveDay(f.key).replaceAll('/', '-')).sort()[0]

  const byMonth = new Map<string, number>()
  for (const f of files) {
    const month = f.key.replace('events/', '').slice(0, 7).replace('/', '-')
    byMonth.set(month, (byMonth.get(month) ?? 0) + (f.events ?? 0))
  }
  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([label, total]) => ({ label, total }))

  return {
    totalDays: files.length,
    totalBytes,
    totalEvents,
    missingMeta,
    oldestDay,
    monthly,
  }
}
