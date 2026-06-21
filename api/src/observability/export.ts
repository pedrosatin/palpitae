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

// Limite explícito de linhas por export. A SQL API do Analytics Engine corta o
// resultado (~10k linhas) silenciosamente; fixamos o teto para conseguir detectar
// quando provavelmente truncou (rows.length === ROW_LIMIT ⇒ console.warn).
const ROW_LIMIT = 10000

// Backfill (#4): teto de exports por execução do cron, p/ não estourar tempo/CPU.
const MAX_EXPORTS_PER_RUN = 10

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
    `ORDER BY timestamp ASC ` +
    `LIMIT ${ROW_LIMIT}`

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
    // Grava um marcador vazio mesmo sem eventos: marca o dia como exportado pro
    // backfill (head()) não re-consultar este dia em toda execução — senão um dia
    // ocioso ficaria sendo re-queriado pra sempre, gastando o teto de exports/run.
    // Um .ndjson vazio é um arquivo NDJSON válido (zero registros).
    await env.EVENTS.put(key, '', { httpMetadata: { contentType: 'application/x-ndjson' } })
    console.info(`[export] ${key}: 0 eventos — marcador vazio gravado.`)
    return
  }

  // #5: se batemos o teto, a SQL API provavelmente truncou o resultado e
  // perdemos eventos desse dia. Avisa nos Workers Logs.
  if (rows.length >= ROW_LIMIT) {
    console.warn(
      `[export] ${key}: ${rows.length} linhas atingiram o LIMIT ${ROW_LIMIT} — ` +
        'provável truncamento, eventos podem ter sido perdidos.',
    )
  }

  const ndjson = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
  await env.EVENTS.put(key, ndjson, {
    httpMetadata: { contentType: 'application/x-ndjson' },
  })

  console.info(`[export] ${key}: ${rows.length} eventos arquivados.`)
}

/**
 * Backfill (#4): exporta não só "ontem", mas qualquer dia FALTANTE dentro da
 * janela de retenção. Para cada dia de today-1 até today-lookbackDays, checa se
 * a chave já existe no R2 (head); se não, exporta. Idempotente (re-put na mesma
 * chave é seguro). Limita exports por execução (MAX_EXPORTS_PER_RUN) p/ não
 * estourar tempo/CPU do cron — dias restantes pegam na próxima execução.
 *
 * No-op se R2/credenciais não estiverem configurados (dev local/testes).
 */
export async function exportRecentDays(
  env: Env,
  today: Date,
  lookbackDays = 90,
): Promise<void> {
  if (!env.EVENTS || !env.CF_ACCOUNT_ID || !env.AE_SQL_TOKEN) {
    console.warn('[export] R2/SQL API não configurado — backfill ignorado.')
    return
  }

  let exported = 0
  for (let back = 1; back <= lookbackDays; back++) {
    if (exported >= MAX_EXPORTS_PER_RUN) {
      console.info(
        `[export] teto de ${MAX_EXPORTS_PER_RUN} exports/execução atingido — ` +
          'dias restantes serão exportados na próxima execução.',
      )
      break
    }

    const day = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back),
    )
    const { key } = dayBounds(day)

    const existing = await env.EVENTS.head(key)
    if (existing) continue

    try {
      await exportEventsToR2(env, day)
      exported++
    } catch (err) {
      // Isola a falha de um dia — não trava o backfill dos demais. Sem arquivo, o
      // dia é re-tentado na próxima execução (não conta no teto de exports).
      console.error(`[export] falha ao exportar ${key} — pulando:`, err)
    }
  }
}
