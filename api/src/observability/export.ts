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
 * Cada arquivo leva um manifesto em `customMetadata` (`events`, `rows`, `complete`
 * e, só quando o dia passou do teto, `truncatedTypes`). Só `complete: '1'` encerra
 * o dia; os demais são reconsultados pelo backfill e substituídos quando a nova
 * coleta não perde linhas.
 */

const DATASET = 'palpitae_events'

// Linhas por consulta. A SQL API do Analytics Engine corta o resultado (~10k
// linhas) silenciosamente; com o teto explícito, página cheia significa "pode
// haver mais" e a coleta continua a partir do último segundo lido.
const ROW_LIMIT = 10000

// Teto de páginas por dia (30 mil linhas, cerca de 120 vezes o maior dia de
// 2026): o dia inteiro fica em memória antes do put, e o Worker tem 128 MB.
// Dia que passa disso tem os tipos de volume cortados, como descreve `collectRows`.
// Se o corte alcança eventos de negócio, o dia é gravado incompleto e reconsultado
// a cada execução.
const MAX_PAGES = 3

// Tipos de evento de alto volume e baixo valor. Quando o dia passa do teto, só
// eles podem ficar de fora do arquivo. Os demais, como `account_created` e
// `security_storage_error`, são lidos por uma consulta própria. O tipo vem de
// `blob1`, que o AE guarda repetido do índice, como descreve `events.ts`.
const VOLUME_EVENT_TYPES = [
  'oauth_error',
  'matches_cache',
  'request_perf',
  'provider_http_attempt',
  'poller_run',
] as const

// Páginas da consulta de eventos de negócio depois do corte. Esses eventos somam
// centenas por dia; duas páginas bastam e limitam o custo em chamadas ao AE.
const MAX_BUSINESS_PAGES = 2

// Um dia só é dado como completo quando exportado ao menos 24 h depois de
// terminar. O export das 00:05 é provisório e vira definitivo no cron seguinte,
// que reconsulta o dia e pega linhas que a SQL API ainda não devolvia.
const SETTLE_MS = 24 * 60 * 60 * 1000

// Backfill (#4): teto de exports por execução do cron, p/ não estourar tempo/CPU.
const MAX_EXPORTS_PER_RUN = 10

// A partir de quantos dias atrás uma coleta completa com MENOS linhas que o
// arquivo fecha o dia com o corpo arquivado. Perto do fim da retenção do AE
// (~90 dias) a coleta só tende a encolher; antes disso, a diferença pode ser
// passageira e o dia continua aberto para a próxima execução.
const CLOSE_KEPT_FROM_DAYS_BACK = 80

const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** Manifesto de completude gravado em `customMetadata` de cada arquivo diário. */
type Manifest = {
  events: string
  rows: string
  complete: '1' | '0'
  /** Tipos de volume com linhas fora do arquivo, separados por vírgula. Ausente se não houve corte. */
  truncatedTypes?: string
}

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

const VOLUME_SQL_LIST = VOLUME_EVENT_TYPES.map((type) => `'${type}'`).join(', ')

function rangeSql(cursor: string, to: string): string {
  assertDateTime(cursor)
  assertDateTime(to)
  return `WHERE timestamp >= toDateTime('${cursor}') AND timestamp < toDateTime('${to}')`
}

/** Página do dia inteiro, de todos os tipos, em ordem de tempo. */
function pageSql(cursor: string, to: string): string {
  return `SELECT * FROM ${DATASET} ${rangeSql(cursor, to)} ORDER BY timestamp ASC LIMIT ${ROW_LIMIT}`
}

/** Página só dos eventos fora da lista de volume. */
function businessPageSql(cursor: string, to: string): string {
  return (
    `SELECT * FROM ${DATASET} ${rangeSql(cursor, to)} ` +
    `AND blob1 NOT IN (${VOLUME_SQL_LIST}) ORDER BY timestamp ASC LIMIT ${ROW_LIMIT}`
  )
}

/** Quais tipos de volume têm linhas em [cursor, to). Uma linha por tipo. */
function volumeTypesSql(cursor: string, to: string): string {
  return (
    `SELECT blob1 AS event_type FROM ${DATASET} ${rangeSql(cursor, to)} ` +
    `AND blob1 IN (${VOLUME_SQL_LIST}) GROUP BY blob1`
  )
}

/**
 * Lê todas as linhas de [from, to) em páginas de ROW_LIMIT. Página cheia não é
 * o fim: as linhas do último segundo dela são descartadas e a próxima página
 * começa nesse segundo, para que nenhum segundo fique dividido entre páginas.
 * `truncated` indica que sobrou dado sem ler (um único segundo com mais de
 * ROW_LIMIT linhas ou `maxPages` esgotado). Nesse caso, `cursor` é o primeiro
 * segundo não lido: `rows` tem tudo o que veio antes dele e nada dele em diante.
 */
async function collectPages(
  env: Env,
  sqlFor: (cursor: string, to: string) => string,
  from: string,
  to: string,
  maxPages: number,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean; cursor: string }> {
  const rows: Record<string, unknown>[] = []
  let cursor = from
  for (let page = 0; page < maxPages; page++) {
    const batch = await runAeSqlStrict(env, sqlFor(cursor, to))
    if (batch.length < ROW_LIMIT) {
      rows.push(...batch)
      return { rows, truncated: false, cursor }
    }
    const last = String(batch[batch.length - 1].timestamp)
    const settled = batch.filter((row) => String(row.timestamp) !== last)
    if (settled.length === 0) break
    rows.push(...settled)
    cursor = last
  }
  return { rows, truncated: true, cursor }
}

/**
 * Lê o dia em ordem de tempo. Se ele cabe no teto, é uma consulta só e o arquivo
 * sai como sempre. Se passa do teto, o que ficou depois do corte pode esconder
 * eventos de negócio e de segurança atrás de tráfego de volume. Então uma
 * segunda consulta traz só os eventos fora da lista de volume dali em diante, e
 * uma sonda diz quais tipos de volume ficaram com linhas sem ler.
 */
async function collectRows(
  env: Env,
  from: string,
  to: string,
): Promise<{ rows: Record<string, unknown>[]; businessTruncated: boolean; truncatedTypes: string[] }> {
  const ordered = await collectPages(env, pageSql, from, to, MAX_PAGES)
  if (!ordered.truncated) {
    return { rows: ordered.rows, businessTruncated: false, truncatedTypes: [] }
  }

  const business = await collectPages(env, businessPageSql, ordered.cursor, to, MAX_BUSINESS_PAGES)
  const unread = await runAeSqlStrict(env, volumeTypesSql(ordered.cursor, to))
  const unreadTypes = new Set(unread.map((row) => String(row.event_type)))
  return {
    rows: [...ordered.rows, ...business.rows],
    businessTruncated: business.truncated,
    truncatedTypes: VOLUME_EVENT_TYPES.filter((type) => unreadTypes.has(type)),
  }
}

/** Coleta `day` (UTC) no AE e monta o arquivo e o manifesto, sem gravar. */
async function buildDayExport(env: Env, day: Date, now: Date): Promise<DayExport> {
  const { from, to, key } = dayBounds(day)
  const { rows, businessTruncated, truncatedTypes } = await collectRows(env, from, to)

  if (businessTruncated) {
    console.warn(
      `[export] ${key}: ${rows.length} linhas lidas e ainda havia mais — ` +
        'arquivo marcado como incompleto.',
    )
  } else if (truncatedTypes.length > 0) {
    console.warn(
      `[export] ${key}: ${rows.length} linhas lidas; tipos de volume cortados no teto: ` +
        `${truncatedTypes.join(', ')}.`,
    )
  }

  // Contagem REAL de eventos do dia: sob sampling cada linha vale
  // _sample_interval linhas, então soma-se o intervalo, não rows.length.
  // Vai em customMetadata pra `list()` devolver a contagem sem ler o arquivo —
  // é o que alimenta a série histórica do dashboard além da janela do AE.
  const events = rows.reduce((sum, r) => sum + Number(r._sample_interval ?? 1), 0)
  const settled = now.getTime() - Date.parse(`${to.replace(' ', 'T')}Z`) >= SETTLE_MS
  // Corte só em tipos de volume não mantém o dia aberto: reconsultar não traria
  // as linhas que sobraram, só repetiria o custo em chamadas ao AE.
  const complete = !businessTruncated && settled

  // Dia sem eventos vira um NDJSON vazio (zero registros, arquivo válido): o
  // manifesto distingue esse dia de uma coleta que falhou, que não grava nada.
  const body = rows.length === 0 ? '' : `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
  return {
    key,
    body,
    rows: rows.length,
    complete,
    manifest: {
      events: String(events),
      rows: String(rows.length),
      complete: complete ? '1' : '0',
      ...(truncatedTypes.length > 0 ? { truncatedTypes: truncatedTypes.join(',') } : {}),
    },
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
 * Se a coleta nova, já completa, tem MENOS linhas, o corpo arquivado fica. Perto
 * do fim da retenção do AE (`nearRetentionEnd`), o arquivo é o melhor registro
 * que vai existir do dia, e o manifesto contado do próprio NDJSON passa a dizer
 * que o dia está fechado. Antes disso (amostragem na leitura, por exemplo), o
 * dia continua com `complete: '0'` e é reconsultado na próxima execução.
 */
async function repairDay(
  env: Env & { EVENTS: R2Bucket },
  day: Date,
  key: string,
  existing: R2Object,
  now: Date,
  nearRetentionEnd: boolean,
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
  // Fora do fim da retenção, ou com coleta nova provisória ou truncada, o dia
  // fica aberto e volta na próxima execução. Só regrava agora para fechar o dia
  // ou se o arquivo nem tinha a contagem de eventos (export antigo).
  const close = fresh.complete && nearRetentionEnd
  if (!close && meta.events !== undefined) return
  const manifest: Manifest = {
    events: String(counted.events),
    rows: String(counted.rows),
    complete: close ? '1' : '0',
    ...(meta.truncatedTypes ? { truncatedTypes: meta.truncatedTypes } : {}),
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
        await repairDay(env, day, key, existing, today, back >= CLOSE_KEPT_FROM_DAYS_BACK)
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
