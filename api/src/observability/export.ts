import type { Env } from '../types'
import { runAeSqlStrict } from './aeSql'

/**
 * Cold path — arquiva um dia de eventos do Analytics Engine no R2 como NDJSON,
 * com retenção ILIMITADA (o AE só guarda ~3 meses). Roda num cron diário (00:05 UTC)
 * e exporta o dia ANTERIOR. Ver `docs/observability.md`.
 *
 * Desenho: o AE é o staging (escrita barata, sem latência); este export "congela"
 * tudo em R2 1x/dia. Um arquivo/dia ⇒ ~365 escritas/ano, irrisório no free tier
 * (10 GB, egress zero, não expira). Reaproveita o cron que já existe — sem Queues.
 *
 * Cada arquivo leva um manifesto em `customMetadata` (`events`, `rows`, `complete`).
 * Só `complete: '1'` encerra o dia; os demais são reconsultados pelo backfill e
 * substituídos quando a nova coleta não perde linhas.
 */

const DATASET = 'palpitae_events'

// Linhas por consulta. A SQL API do Analytics Engine corta o resultado (~10k
// linhas) silenciosamente; com o teto explícito, página cheia significa "pode
// haver mais" e a coleta continua a partir do último segundo lido.
const ROW_LIMIT = 10000

// Teto de páginas por dia (100 mil linhas): limita memória e tempo do cron.
const MAX_PAGES = 10

// Um dia só é dado como completo quando exportado ao menos 24 h depois de
// terminar. O export das 00:05 é provisório e vira definitivo no cron seguinte,
// que reconsulta o dia e pega linhas que a SQL API ainda não devolvia.
const SETTLE_MS = 24 * 60 * 60 * 1000

// Backfill (#4): teto de exports por execução do cron, p/ não estourar tempo/CPU.
const MAX_EXPORTS_PER_RUN = 10

const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** Manifesto de completude gravado em `customMetadata` de cada arquivo diário. */
type Manifest = { events: string; rows: string; complete: '1' | '0' }

/** Um dia coletado do AE, pronto para gravar. */
type DayExport = { key: string; body: string; rows: number; complete: boolean; manifest: Manifest }

/** Limites UTC do dia e a chave R2 correspondente. Exportado para testes. */
export function dayBounds(day: Date): {
  from: string
  to: string
  key: string
} {
  if (isNaN(day.getTime())) {
    throw new TypeError('Invalid Date')
  }

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

function isConfigured(env: Env): env is Env & { EVENTS: R2Bucket } {
  return Boolean(env.EVENTS && env.CF_ACCOUNT_ID && env.AE_SQL_TOKEN)
}

function assertDateTime(value: string): void {
  // A SQL API do Analytics Engine é ClickHouse-like e não aceita bind params:
  // todo instante interpolado na consulta passa por esta validação.
  if (!DATE_TIME.test(value)) {
    throw new Error(`Instante inválido para a consulta do export: ${value}`)
  }
}

function pageSql(cursor: string, to: string): string {
  assertDateTime(cursor)
  assertDateTime(to)
  return (
    `SELECT * FROM ${DATASET} ` +
    `WHERE timestamp >= toDateTime('${cursor}') AND timestamp < toDateTime('${to}') ` +
    `ORDER BY timestamp ASC ` +
    `LIMIT ${ROW_LIMIT}`
  )
}

/**
 * Lê todas as linhas de [from, to) em páginas de ROW_LIMIT. Página cheia não é
 * o fim: as linhas do último segundo dela são descartadas e a próxima página
 * começa nesse segundo, para que nenhum segundo fique dividido entre páginas.
 * `truncated` indica que sobrou dado sem ler (um único segundo com mais de
 * ROW_LIMIT linhas ou MAX_PAGES esgotado).
 */
async function collectRows(
  env: Env,
  from: string,
  to: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = []
  let cursor = from
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await runAeSqlStrict(env, pageSql(cursor, to))
    if (batch.length < ROW_LIMIT) {
      rows.push(...batch)
      return { rows, truncated: false }
    }
    const last = String(batch[batch.length - 1].timestamp)
    const settled = batch.filter((row) => String(row.timestamp) !== last)
    if (settled.length === 0) break
    rows.push(...settled)
    cursor = last
  }
  return { rows, truncated: true }
}

/** Coleta `day` (UTC) no AE e monta o arquivo e o manifesto, sem gravar. */
async function buildDayExport(env: Env, day: Date, now: Date): Promise<DayExport> {
  const { from, to, key } = dayBounds(day)
  const { rows, truncated } = await collectRows(env, from, to)

  if (truncated) {
    console.warn(
      `[export] ${key}: ${rows.length} linhas lidas e ainda havia mais — ` +
        'arquivo marcado como incompleto.',
    )
  }

  // Contagem REAL de eventos do dia: sob sampling cada linha vale
  // _sample_interval linhas, então soma-se o intervalo, não rows.length.
  // Vai em customMetadata pra `list()` devolver a contagem sem ler o arquivo —
  // é o que alimenta a série histórica do dashboard além da janela do AE.
  const events = rows.reduce((sum, r) => sum + Number(r._sample_interval ?? 1), 0)
  const settled = now.getTime() - Date.parse(`${to.replace(' ', 'T')}Z`) >= SETTLE_MS
  const complete = !truncated && settled

  // Dia sem eventos vira um NDJSON vazio (zero registros, arquivo válido): o
  // manifesto distingue esse dia de uma coleta que falhou, que não grava nada.
  const body = rows.length === 0 ? '' : `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
  return {
    key,
    body,
    rows: rows.length,
    complete,
    manifest: { events: String(events), rows: String(rows.length), complete: complete ? '1' : '0' },
  }
}

function putOptions(manifest: Manifest, onlyIf?: R2Conditional): R2PutOptions {
  return {
    httpMetadata: { contentType: 'application/x-ndjson' },
    customMetadata: manifest,
    ...(onlyIf ? { onlyIf } : {}),
  }
}

/**
 * Exporta os eventos de `day` (UTC) para `events/YYYY/MM/DD.ndjson` no R2.
 * Falha na consulta lança antes de gravar: o dia fica sem arquivo e o backfill
 * tenta de novo. No-op se R2/credenciais da SQL API não estiverem configurados
 * (dev local/testes).
 */
export async function exportEventsToR2(env: Env, day: Date, now = new Date()): Promise<void> {
  if (!isConfigured(env)) return

  const exported = await buildDayExport(env, day, now)
  await env.EVENTS.put(exported.key, exported.body, putOptions(exported.manifest))
  console.info(
    `[export] ${exported.key}: ${exported.rows} linhas (${exported.manifest.events} eventos) ` +
      `arquivadas, completo=${exported.manifest.complete}.`,
  )
}

/** Conta linhas e eventos do NDJSON já arquivado. */
function countArchived(body: string): { rows: number; events: number } {
  const lines = body.split('\n').filter((l) => l.trim() !== '')
  const events = lines.reduce((sum, line) => {
    const row = JSON.parse(line) as Record<string, unknown>
    return sum + Number(row._sample_interval ?? 1)
  }, 0)
  return { rows: lines.length, events }
}

/** Troca o objeto só se ele ainda for o lido no `head` (mesmo etag). */
async function replaceIfUnchanged(
  bucket: R2Bucket,
  key: string,
  body: string,
  manifest: Manifest,
  etag: string,
): Promise<boolean> {
  const written = await bucket.put(key, body, putOptions(manifest, { etagMatches: etag }))
  if (written === null) {
    console.warn(`[export] ${key}: objeto mudou durante o reparo — mantido o atual.`)
    return false
  }
  return true
}

/**
 * Reconsulta um dia já arquivado sem manifesto completo e troca o arquivo só se
 * a coleta nova não perde linhas: mais linhas, ou completa com ao menos as
 * mesmas. A troca é condicionada ao etag lido no `head` — se o objeto mudou no
 * meio do caminho, o R2 recusa e o arquivo atual fica. Falha na consulta ou no
 * upload lança antes de tocar no objeto, que continua o mesmo.
 *
 * Se a coleta nova, já completa, tem MENOS linhas (o dia saiu da retenção do AE,
 * por exemplo), o arquivo é o melhor registro que existe do dia: o corpo fica e
 * o manifesto, contado do próprio NDJSON, passa a dizer que o dia está fechado.
 */
async function repairDay(
  env: Env & { EVENTS: R2Bucket },
  day: Date,
  key: string,
  existing: R2Object,
  now: Date,
): Promise<void> {
  const bucket = env.EVENTS
  const meta = existing.customMetadata ?? {}
  const archived = existing.size === 0 ? '' : await (await bucket.get(key))?.text()
  if (archived === undefined) return
  const counted = countArchived(archived)

  const fresh = await buildDayExport(env, day, now)
  if (fresh.rows > counted.rows || (fresh.complete && fresh.rows >= counted.rows)) {
    if (await replaceIfUnchanged(bucket, key, fresh.body, fresh.manifest, existing.etag)) {
      console.info(
        `[export] ${key}: reparado de ${counted.rows} para ${fresh.rows} linhas, ` +
          `completo=${fresh.manifest.complete}.`,
      )
    }
    return
  }

  console.warn(
    `[export] ${key}: nova coleta tem ${fresh.rows} linhas e o arquivo tem ${counted.rows} — mantido.`,
  )
  // Coleta nova ainda provisória ou truncada: tenta de novo na próxima execução.
  // Só regrava agora se o arquivo nem tinha a contagem de eventos (export antigo).
  if (!fresh.complete && meta.events !== undefined) return
  const manifest: Manifest = {
    events: String(counted.events),
    rows: String(counted.rows),
    complete: fresh.complete ? '1' : '0',
  }
  await replaceIfUnchanged(bucket, key, archived, manifest, existing.etag)
}

/**
 * Backfill (#4): exporta não só "ontem", mas qualquer dia FALTANTE ou ainda não
 * COMPLETO dentro da janela de retenção. Para cada dia de today-1 até
 * today-lookbackDays, lê o manifesto no R2 (head): sem arquivo, exporta; arquivo
 * sem `complete: '1'` (provisório, truncado ou de antes do manifesto), repara.
 * Limita exports por execução (MAX_EXPORTS_PER_RUN) p/ não estourar tempo/CPU
 * do cron — dias restantes pegam na próxima execução.
 *
 * No-op se R2/credenciais não estiverem configurados (dev local/testes).
 */
export async function exportRecentDays(env: Env, today: Date, lookbackDays = 90): Promise<void> {
  if (!isConfigured(env)) return

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

    try {
      const existing = await env.EVENTS.head(key)
      if (existing?.customMetadata?.complete === '1') continue
      exported++
      if (existing) {
        await repairDay(env, day, key, existing, today)
      } else {
        await exportEventsToR2(env, day, today)
      }
    } catch (err) {
      // Isola a falha de um dia — não trava o backfill dos demais. O arquivo
      // anterior (se havia) segue intacto e o dia é re-tentado na próxima execução.
      console.error(`[export] falha ao exportar ${key} — pulando:`, err)
    }
  }
}
