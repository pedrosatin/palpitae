/**
 * Leitura do arquivo frio para `GET /metrics/archive/query` com memória limitada.
 * Ver `docs/observability.md`.
 *
 * Um dia cheio tem até 30 mil linhas de ~615 bytes (~18 MiB). Ler os corpos de um
 * mês inteiro de uma vez passa dos 128 MiB do Worker, então cada arquivo é lido
 * sozinho, em streaming, linha a linha, e o corpo é solto antes do próximo. A
 * memória fica no tamanho de um pedaço do stream mais os contadores por tipo.
 */

/** Teto de bytes lidos do R2 por consulta. Passou dele, o resultado sai parcial. */
export const ARCHIVE_QUERY_MAX_BYTES = 64 * 1024 * 1024

/** Maior intervalo aceito pela consulta, em dias. */
export const MAX_QUERY_SPAN_DAYS = 92

/**
 * Linha maior que isso conta como malformada e é descartada sem acumular o
 * resto. Uma linha real tem ~615 bytes; sem o limite, um arquivo sem quebra de
 * linha juntaria o corpo inteiro numa string só.
 */
const MAX_LINE_CHARS = 64 * 1024

const DAY_MS = 24 * 60 * 60 * 1000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Dia YYYY-MM-DD em ms UTC; null se não for uma data real (ex.: 2026-02-31). */
function parseDay(day: string): number | null {
  if (!DAY_RE.test(day)) return null
  const ms = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return null
  return ms
}

/**
 * Lista de dias YYYY-MM-DD de `from` a `to` (inclusive), UTC. O tamanho do
 * intervalo é conferido antes de montar a lista: um intervalo de séculos
 * recebe erro sem gerar um dia sequer.
 */
export function daysInRange(
  from: string,
  to: string,
  maxDays = MAX_QUERY_SPAN_DAYS,
): { days: string[] } | { error: 'invalid' | 'too_long' } {
  const start = parseDay(from)
  const end = parseDay(to)
  if (start === null || end === null || start > end) return { error: 'invalid' }
  const span = (end - start) / DAY_MS + 1
  if (span > maxDays) return { error: 'too_long' }
  return {
    days: Array.from({ length: span }, (_, i) =>
      new Date(start + i * DAY_MS).toISOString().slice(0, 10),
    ),
  }
}

interface DayTally {
  byType: Map<string, number>
  total: number
  malformed: number
  bytes: number
}

/** Soma uma linha do NDJSON ao dia. Linha que não é objeto JSON válido conta como malformada. */
function countLine(line: string, tally: DayTally): void {
  if (line.trim() === '') return
  let row: unknown
  try {
    row = JSON.parse(line)
  } catch {
    tally.malformed++
    return
  }
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    tally.malformed++
    return
  }
  const fields = row as Record<string, unknown>
  const weight = Number(fields._sample_interval ?? 1)
  if (!Number.isFinite(weight) || weight < 0) {
    tally.malformed++
    return
  }
  const type = String(fields.blob1 ?? 'unknown')
  tally.byType.set(type, (tally.byType.get(type) ?? 0) + weight)
  tally.total += weight
}

/**
 * Lê um corpo NDJSON em streaming e agrega linha a linha. Uma linha pode chegar
 * partida entre dois pedaços do stream: o trecho sem quebra de linha fica em
 * `pending` até o próximo pedaço. Devolve null quando o corpo passa de
 * `budget` bytes; nesse caso o stream é cancelado e o dia fica de fora.
 */
async function tallyBody(
  body: ReadableStream<Uint8Array>,
  budget: number,
): Promise<DayTally | null> {
  const tally: DayTally = { byType: new Map(), total: 0, malformed: 0, bytes: 0 }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  // Descartando o resto de uma linha acima de MAX_LINE_CHARS, já contada.
  let skipping = false

  const consume = (text: string) => {
    pending += text
    let start = 0
    let nl = pending.indexOf('\n')
    while (nl !== -1) {
      if (skipping) skipping = false
      else countLine(pending.slice(start, nl), tally)
      start = nl + 1
      nl = pending.indexOf('\n', start)
    }
    pending = pending.slice(start)
    if (pending.length > MAX_LINE_CHARS) {
      if (!skipping) tally.malformed++
      skipping = true
      pending = ''
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      tally.bytes += value.byteLength
      if (tally.bytes > budget) {
        await reader.cancel()
        return null
      }
      consume(decoder.decode(value, { stream: true }))
    }
    consume(decoder.decode())
    if (!skipping) countLine(pending, tally)
    return tally
  } finally {
    reader.releaseLock()
  }
}

export interface ArchiveQueryResult {
  filesRead: number
  totalEvents: number
  byType: { event_type: string; count: number }[]
  byDay: { day: string; count: number }[]
  /** Dias cujo arquivo entrou no resultado, em ordem. */
  daysRead: string[]
  /** true quando o teto de bytes parou a leitura antes do último dia. */
  truncated: boolean
  malformedLines: number
  bytesRead: number
}

/**
 * Agrega os NDJSON dos `days`, um arquivo por vez. Antes de abrir cada corpo
 * confere o tamanho declarado pelo R2 contra o que sobra do teto; durante a
 * leitura conta os bytes de fato recebidos. Passou do teto, para ali e devolve
 * os dias já lidos com `truncated: true`. Dia lido pela metade não entra.
 */
export async function queryArchive(
  bucket: R2Bucket,
  days: string[],
  maxBytes = ARCHIVE_QUERY_MAX_BYTES,
): Promise<ArchiveQueryResult> {
  const byType = new Map<string, number>()
  const byDay: { day: string; count: number }[] = []
  let bytesRead = 0
  let malformedLines = 0
  let truncated = false

  for (const day of days) {
    const obj = await bucket.get(`events/${day.replaceAll('-', '/')}.ndjson`)
    if (!obj) continue
    if (bytesRead + obj.size > maxBytes) {
      await obj.body.cancel()
      truncated = true
      break
    }
    const tally = await tallyBody(obj.body, maxBytes - bytesRead)
    if (!tally) {
      truncated = true
      break
    }
    bytesRead += tally.bytes
    malformedLines += tally.malformed
    for (const [type, count] of tally.byType) {
      byType.set(type, (byType.get(type) ?? 0) + count)
    }
    byDay.push({ day, count: tally.total })
  }

  return {
    filesRead: byDay.length,
    totalEvents: byDay.reduce((sum, d) => sum + d.count, 0),
    byType: [...byType.entries()]
      .map(([event_type, count]) => ({ event_type, count }))
      .sort((a, b) => b.count - a.count),
    byDay,
    daysRead: byDay.map((d) => d.day),
    truncated,
    malformedLines,
    bytesRead,
  }
}
