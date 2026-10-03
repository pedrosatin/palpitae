import type { Env } from '../types'

/**
 * Runs a query against the Analytics Engine SQL API and returns the data rows.
 * Shared by the cold-path R2 export and the admin metrics proxy.
 */
export async function runAeSql(
  env: Env,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AE_SQL_TOKEN}` },
      body: sql,
    },
  )
  if (!res.ok) {
    throw new Error(`AE SQL respondeu ${res.status}: ${await res.text()}`)
  }
  const payload = (await res.json()) as { data?: Record<string, unknown>[] }
  return payload.data ?? []
}
