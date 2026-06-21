import type { Env } from '../types'

/**
 * Cold path — arquiva um dia de eventos do Analytics Engine no R2 como NDJSON,
 * com retenção ILIMITADA (o AE só guarda ~3 meses). Roda num cron diário (00:05 UTC)
 * e exporta o dia ANTERIOR, já completo. Ver `docs/observability.md`.
 *
 * Desenho: o AE é o staging (escrita barata, sem latência); este export "congela"
 * tudo em R2 1x/dia. Um arquivo/dia ⇒ ~365 escritas/ano, irrisório no free tier
 * (10 GB, egress zero, não expira). Reaproveita o cron que já existe — sem Queues.
 */

const DATASET = 'palpitae_events'

/** Limites UTC do dia e a chave R2 correspondente. Exportado para testes. */
export function dayBounds(day: Date): { from: string; to: string; key: string } {
  const y = day.getUTCFullYear()
  const m = String(day.getUTCMonth() + 1).padStart(2, '0')
  const d = String(day.getUTCDate()).padStart(2, '0')

  const next = new Date(Date.UTC(y, day.getUTCMonth(), day.getUTCDate() + 1))
  const ny = next.getUTCFullYear()
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0')
  const nd = String(next.getUTCDate()).padStart(2, '0')

  return {
    from: `${y}-${m}-${d} 00:00:00`,
    to: `${ny}-${nm}-${nd} 00:00:00`,
    key: `events/${y}/${m}/${d}.ndjson`,
  }
}

/**
 * Exporta os eventos de `day` (UTC) para `events/YYYY/MM/DD.ndjson` no R2.
 * No-op se R2/credenciais da SQL API não estiverem configurados (dev local/testes).
 */
export async function exportEventsToR2(env: Env, day: Date): Promise<void> {
  if (!env.EVENTS || !env.CF_ACCOUNT_ID || !env.AE_SQL_TOKEN) {
    console.warn('[export] R2/SQL API não configurado — export ignorado.')
    return
  }

  const { from, to, key } = dayBounds(day)

  // A SQL API do Analytics Engine é ClickHouse-like e não aceita bind params —
  // os limites vêm de dayBounds (não de input externo), então a interpolação é segura.
  const sql =
    `SELECT * FROM ${DATASET} ` +
    `WHERE timestamp >= toDateTime('${from}') AND timestamp < toDateTime('${to}') ` +
    `ORDER BY timestamp ASC`

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    { method: 'POST', headers: { Authorization: `Bearer ${env.AE_SQL_TOKEN}` }, body: sql },
  )

  if (!res.ok) {
    throw new Error(`AE SQL respondeu ${res.status}: ${await res.text()}`)
  }

  const payload = (await res.json()) as { data?: Record<string, unknown>[] }
  const rows = payload.data ?? []

  if (rows.length === 0) {
    console.info(`[export] ${key}: 0 eventos — nada a gravar.`)
    return
  }

  const ndjson = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
  await env.EVENTS.put(key, ndjson, {
    httpMetadata: { contentType: 'application/x-ndjson' },
  })

  console.info(`[export] ${key}: ${rows.length} eventos arquivados.`)
}
