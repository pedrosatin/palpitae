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

  // Validate limits to prevent SQL injection since Cloudflare AE API does not support bind parameters.
  // Although `from` and `to` come from `dayBounds`, this ensures strict safety.
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2} 00:00:00$/
  if (!dateTimeRegex.test(from) || !dateTimeRegex.test(to)) {
    throw new Error('Invalid date format for export bounds')
  }

  // A SQL API do Analytics Engine é ClickHouse-like e não aceita bind params —
  // os limites foram estritamente validados acima.
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
    await env.EVENTS.put(key, '', {
      httpMetadata: { contentType: 'application/x-ndjson' },
      customMetadata: { events: '0' },
    })
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

  // Contagem REAL de eventos do dia: sob sampling cada linha vale
  // _sample_interval linhas, então soma-se o intervalo, não rows.length.
  // Vai em customMetadata pra `list()` devolver a contagem sem ler o arquivo —
  // é o que alimenta a série histórica do dashboard além da janela do AE.
  const events = rows.reduce((sum, r) => sum + Number(r._sample_interval ?? 1), 0)

  const ndjson = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
  await env.EVENTS.put(key, ndjson, {
    httpMetadata: { contentType: 'application/x-ndjson' },
    customMetadata: { events: String(events) },
  })

  console.info(`[export] ${key}: ${rows.length} linhas (${events} eventos) arquivadas.`)
}

/**
 * Adiciona `customMetadata.events` a um NDJSON arquivado antes da contagem
 * existir. Lê o arquivo, soma `_sample_interval` de cada linha (contagem real
 * sob sampling) e regrava o mesmo corpo com a metadata — R2 não atualiza
 * metadata sem re-put.
 */
async function backfillEventsMetadata(bucket: R2Bucket, key: string): Promise<void> {
  const obj = await bucket.get(key)
  if (!obj) return

  const body = await obj.text()
  const lines = body.split('\n').filter((l) => l.trim() !== '')
  const events = lines.reduce((sum, line) => {
    const row = JSON.parse(line) as Record<string, unknown>
    return sum + Number(row._sample_interval ?? 1)
  }, 0)

  await bucket.put(key, body, {
    httpMetadata: { contentType: 'application/x-ndjson' },
    customMetadata: { events: String(events) },
  })
  console.info(`[export] ${key}: metadata backfill — ${events} eventos.`)
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
    if (existing) {
      // Arquivo sem `events` no customMetadata é de antes da contagem existir.
      // Conta a partir do PRÓPRIO NDJSON (não re-consulta o AE: se o dia já saiu
      // da retenção, o re-export gravaria um marcador vazio por cima do arquivo
      // bom). Re-put do mesmo corpo + metadata; conta no teto de exports/run.
      if (existing.customMetadata?.events === undefined) {
        try {
          await backfillEventsMetadata(env.EVENTS, key)
          exported++
        } catch (err) {
          console.error(`[export] falha no backfill de metadata de ${key} — pulando:`, err)
        }
      }
      continue
    }

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
