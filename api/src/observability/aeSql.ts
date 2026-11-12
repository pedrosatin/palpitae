import type { Env } from '../types'

/** Tempo máximo de uma consulta à SQL API antes de abortar. */
export const AE_SQL_TIMEOUT_MS = 30_000

type AeSqlPayload = { data?: unknown }

async function postAeSql(env: Env, sql: string): Promise<AeSqlPayload> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AE_SQL_TOKEN}` },
      body: sql,
      signal: AbortSignal.timeout(AE_SQL_TIMEOUT_MS),
    },
  )
  if (!res.ok) {
    throw new Error(`AE SQL respondeu ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as AeSqlPayload
}

/**
 * Runs a query against the Analytics Engine SQL API and returns the data rows.
 * Used by the admin metrics proxy, where a payload without `data` reads as empty.
 */
export async function runAeSql(
  env: Env,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const payload = await postAeSql(env, sql)
  return (payload.data as Record<string, unknown>[] | undefined) ?? []
}

/**
 * Igual a `runAeSql`, mas resposta sem a lista `data` é erro. O export para o R2
 * usa esta versão: lá, "nenhuma linha" vira o marcador de dia vazio, e uma
 * resposta malformada não pode ser confundida com um dia sem eventos.
 */
export async function runAeSqlStrict(
  env: Env,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const payload = await postAeSql(env, sql)
  if (!Array.isArray(payload.data)) {
    throw new Error('AE SQL respondeu sem a lista de linhas (data)')
  }
  return payload.data as Record<string, unknown>[]
}
