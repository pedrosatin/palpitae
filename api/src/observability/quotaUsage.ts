import type { Env } from '../types'
import { logError, tryLogEvent } from './events'

/**
 * Uso diário das cotas do plano Workers Free (ADR-022). O cron das 00:05 UTC lê na
 * API GraphQL de analytics da Cloudflare o uso do dia UTC anterior e grava a medição
 * no Analytics Engine (`cloudflare_usage`). Cada métrica que passa de 50% ou de 80%
 * da cota grava também um `cloudflare_quota_alert`. Ver `docs/observability.md`.
 *
 * As cotas são da conta, então a consulta soma todos os bancos D1 e todos os
 * scripts da conta, sem filtro de banco ou de script.
 */

export const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

/** Tempo máximo da consulta GraphQL antes de abortar. */
export const QUOTA_QUERY_TIMEOUT_MS = 15_000

/**
 * Cotas diárias do plano Free, conferidas em 14/11/2026:
 * - D1, 5 milhões de linhas lidas e 100 mil escritas por dia, com virada às 00:00 UTC
 *   (https://developers.cloudflare.com/d1/platform/pricing/).
 * - Workers, 100 mil requisições por dia, com virada às 00:00 UTC
 *   (https://developers.cloudflare.com/workers/platform/limits/). As requisições às
 *   Functions do Pages contam na mesma cota
 *   (https://developers.cloudflare.com/pages/functions/pricing/).
 */
export const FREE_DAILY_QUOTAS = {
  d1_rows_read: 5_000_000,
  d1_rows_written: 100_000,
  worker_requests: 100_000,
} as const

export type QuotaMetric = keyof typeof FREE_DAILY_QUOTAS

/** Ordem das métricas nos doubles de `cloudflare_usage` e no painel. */
export const QUOTA_METRICS: readonly QuotaMetric[] = [
  'd1_rows_read',
  'd1_rows_written',
  'worker_requests',
]

/** Faixas de alerta em % da cota, da maior para a menor. */
export const QUOTA_ALERT_THRESHOLDS = [80, 50] as const

export type QuotaThreshold = (typeof QUOTA_ALERT_THRESHOLDS)[number]

export type DailyUsage = Record<QuotaMetric, number>

export type QuotaCheckResult = 'ok' | 'config_missing' | 'error'

const QUERY = `query PalpitaeQuotaUsage($accountTag: string!, $date: Date, $start: string, $end: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $date, date_leq: $date }) {
        sum { rowsRead rowsWritten }
      }
      workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_lt: $end }) {
        sum { requests }
      }
    }
  }
}`

type SumGroup<K extends string> = { sum?: Partial<Record<K, unknown>> | null }

type GraphqlPayload = {
  data?: {
    viewer?: {
      accounts?: {
        d1AnalyticsAdaptiveGroups?: SumGroup<'rowsRead' | 'rowsWritten'>[] | null
        workersInvocationsAdaptive?: SumGroup<'requests'>[] | null
      }[]
    } | null
  } | null
  errors?: { message?: unknown }[] | null
}

/** Percentual da cota com uma casa decimal. */
export function quotaPercent(used: number, limit: number): number {
  return Math.round((used / limit) * 1000) / 10
}

/** Maior faixa de alerta alcançada pelo uso, ou null abaixo de 50%. */
export function quotaThreshold(used: number, limit: number): QuotaThreshold | null {
  const percent = (used / limit) * 100
  return QUOTA_ALERT_THRESHOLDS.find((threshold) => percent >= threshold) ?? null
}

/** Dia UTC anterior a `now`, no formato `YYYY-MM-DD`. */
export function previousUtcDay(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  return day.toISOString().slice(0, 10)
}

function nextUtcDay(day: string): string {
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

function sumField<K extends string>(groups: SumGroup<K>[] | null | undefined, field: K): number {
  let total = 0
  for (const group of groups ?? []) {
    const value = Number(group.sum?.[field] ?? 0)
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`GraphQL devolveu ${field} inválido`)
    }
    total += value
  }
  return total
}

/**
 * Consulta o uso de um dia UTC. Lança em resposta não 200, em erro GraphQL e em
 * resposta sem a conta pedida.
 */
export async function fetchDailyUsage(
  env: Pick<Env, 'CF_ACCOUNT_ID' | 'CF_ANALYTICS_TOKEN'>,
  day: string,
): Promise<DailyUsage> {
  const res = await fetch(CF_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        accountTag: env.CF_ACCOUNT_ID,
        date: day,
        start: `${day}T00:00:00Z`,
        end: `${nextUtcDay(day)}T00:00:00Z`,
      },
    }),
    signal: AbortSignal.timeout(QUOTA_QUERY_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`GraphQL respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const payload = (await res.json()) as GraphqlPayload
  if (payload.errors?.length) {
    const messages = payload.errors.map((e) => String(e.message ?? 'sem mensagem')).join('; ')
    throw new Error(`GraphQL respondeu com erro: ${messages.slice(0, 200)}`)
  }
  const account = payload.data?.viewer?.accounts?.[0]
  if (!account) throw new Error('GraphQL respondeu sem a conta pedida')

  return {
    d1_rows_read: sumField(account.d1AnalyticsAdaptiveGroups, 'rowsRead'),
    d1_rows_written: sumField(account.d1AnalyticsAdaptiveGroups, 'rowsWritten'),
    worker_requests: sumField(account.workersInvocationsAdaptive, 'requests'),
  }
}

/**
 * Passo do cron diário. Grava a medição do dia anterior e um alerta por métrica que
 * passou de uma faixa, só com a maior faixa alcançada: 85% grava o alerta de 80% e
 * não o de 50%. A medição é diária, então o alerta se repete a cada dia acima da faixa.
 *
 * Não lança. Sem `CF_ACCOUNT_ID` ou `CF_ANALYTICS_TOKEN`, só avisa no log, porque
 * `scheduled_config_missing` já registra o nome ausente em toda execução agendada.
 * Falha na consulta vira `cloudflare_usage_error` e os demais passos do cron seguem.
 */
export async function checkQuotaUsage(env: Env, now: Date): Promise<QuotaCheckResult> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) {
    const missing = (['CF_ACCOUNT_ID', 'CF_ANALYTICS_TOKEN'] as const).filter((name) => !env[name])
    console.warn(`[cota] Configuração ausente: ${missing.join(', ')}. Medição do dia pulada.`)
    return 'config_missing'
  }

  const day = previousUtcDay(now)
  let usage: DailyUsage
  try {
    usage = await fetchDailyUsage(env, day)
  } catch (error) {
    logError(
      env.AE,
      'cloudflare_usage_error',
      `[cota] Falha ao consultar o uso de ${day}:`,
      error,
      {
        blobs: [day],
      },
    )
    return 'error'
  }

  tryLogEvent(env.AE, 'cloudflare_usage', {
    blobs: [day],
    doubles: QUOTA_METRICS.map((metric) => usage[metric]),
  })

  for (const metric of QUOTA_METRICS) {
    const used = usage[metric]
    const limit = FREE_DAILY_QUOTAS[metric]
    const threshold = quotaThreshold(used, limit)
    if (threshold === null) continue
    const percent = quotaPercent(used, limit)
    console.warn(
      `[cota] ${metric} em ${day}: ${used} de ${limit} (${percent}%), acima de ${threshold}%.`,
    )
    tryLogEvent(env.AE, 'cloudflare_quota_alert', {
      blobs: [metric, String(threshold), day],
      doubles: [used, limit, percent],
    })
  }
  return 'ok'
}
