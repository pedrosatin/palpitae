/**
 * Leitura do arquivo frio para `GET /metrics/archive/query` com memória limitada.
 * Ver `docs/observability.md`.
 *
 * Um dia cheio tem até 30 mil linhas de ~615 bytes (~18 MiB). Ler os corpos de um
 * mês inteiro de uma vez passa dos 128 MiB do Worker, então cada arquivo é lido
 * sozinho, em streaming, linha a linha, e o corpo é solto antes do próximo. A
 * memória fica em um pedaço do stream, um trecho de linha de até 64 KiB e os
 * contadores por tipo.
 */

/**
 * Orçamento de bytes do R2 por consulta. A leitura confere os bytes a cada
 * pedaço recebido e cancela o corpo no pedaço que passa do orçamento; aí o
 * resultado sai parcial.
 */
export const ARCHIVE_QUERY_MAX_BYTES = 64 * 1024 * 1024

/** Maior intervalo aceito pela consulta, em dias. */
export const MAX_QUERY_SPAN_DAYS = 92

/**
 * Linha com mais bytes UTF-8 que isso (sem contar a quebra) conta como
 * malformada e é descartada sem acumular o resto. Uma linha real tem ~615
 * bytes; sem o limite, um arquivo sem quebra de linha juntaria o corpo inteiro
 * na memória.
 */
const MAX_LINE_BYTES = 64 * 1024

const NEWLINE = 0x0a

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
}

/**
 * Peso da linha: `_sample_interval` ausente vale 1. Número ou texto numérico
 * finito e não negativo vale ele mesmo; qualquer outro valor devolve null.
 * Nenhum caminho converte objeto, então nada aqui lança exceção.
 */
function lineWeight(value: unknown): number | null {
  if (value === undefined || value === null) return 1
  let weight: number
  if (typeof value === 'number') weight = value
  else if (typeof value === 'string' && value.trim() !== '') weight = Number(value)
  else return null
  return Number.isFinite(weight) && weight >= 0 ? weight : null
}

/**
 * Soma uma linha do NDJSON ao dia. Conta como malformada a linha que não é
 * objeto JSON, cujo `blob1` não é texto (ausente vira `unknown`) ou cujo
 * `_sample_interval` é inválido.
 */
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
  const weight = lineWeight(fields._sample_interval)
  const blob1 = fields.blob1
  const type = blob1 === undefined || blob1 === null ? 'unknown' : blob1
  if (weight === null || typeof type !== 'string') {
    tally.malformed++
    return
  }
  tally.byType.set(type, (tally.byType.get(type) ?? 0) + weight)
  tally.total += weight
}

/**
 * Separa um corpo NDJSON em linhas pelos bytes, sem depender de como o stream
 * fatia o corpo. A quebra de linha (0x0A) nunca aparece dentro de um caractere
 * UTF-8 de vários bytes, então cortar nela não parte caractere. O trecho de
 * linha ainda sem quebra fica em `parts` até o próximo pedaço, limitado a
 * MAX_LINE_BYTES: uma linha maior conta como malformada uma vez, o trecho é
 * solto e o resto até a próxima quebra é ignorado.
 */
class LineSplitter {
  private parts: Uint8Array[] = []
  private pendingBytes = 0
  private skipping = false
  private readonly decoder = new TextDecoder()

  constructor(private readonly tally: DayTally) {}

  push(chunk: Uint8Array): void {
    let start = 0
    let nl = chunk.indexOf(NEWLINE)
    while (nl !== -1) {
      this.endLine(chunk.subarray(start, nl))
      start = nl + 1
      nl = chunk.indexOf(NEWLINE, start)
    }
    const rest = chunk.subarray(start)
    if (this.skipping || rest.byteLength === 0) return
    if (this.pendingBytes + rest.byteLength > MAX_LINE_BYTES) {
      this.tally.malformed++
      this.skipping = true
      this.parts = []
      this.pendingBytes = 0
      return
    }
    // Cópia: guardar a fatia reteria o pedaço inteiro do stream.
    this.parts.push(rest.slice())
    this.pendingBytes += rest.byteLength
  }

  /** Fecha a última linha, que pode vir sem quebra no fim. */
  finish(): void {
    if (!this.skipping && this.pendingBytes > 0) this.endLine(new Uint8Array(0))
  }

  private endLine(tail: Uint8Array): void {
    const size = this.pendingBytes + tail.byteLength
    if (this.skipping) this.skipping = false
    else if (size > MAX_LINE_BYTES) this.tally.malformed++
    else {
      let line = tail
      if (this.parts.length > 0) {
        line = new Uint8Array(size)
        let offset = 0
        for (const part of this.parts) {
          line.set(part, offset)
          offset += part.byteLength
        }
        line.set(tail, offset)
      }
      countLine(this.decoder.decode(line), this.tally)
    }
    this.parts = []
    this.pendingBytes = 0
  }
}

interface BodyRead {
  /** Bytes recebidos do corpo, inclusive quando a leitura parou no orçamento. */
  bytes: number
  /** Agregados do dia; null quando o corpo passou do orçamento e foi cancelado. */
  tally: DayTally | null
}

/**
 * Lê um corpo NDJSON em streaming e agrega linha a linha. Quando os bytes
 * recebidos passam de `budget`, cancela o stream e devolve `tally: null`, com
 * os bytes recebidos até ali. Se a leitura ou o processamento lançar exceção,
 * o stream é cancelado antes de a exceção seguir.
 */
async function tallyBody(body: ReadableStream<Uint8Array>, budget: number): Promise<BodyRead> {
  const tally: DayTally = { byType: new Map(), total: 0, malformed: 0 }
  const splitter = new LineSplitter(tally)
  const reader = body.getReader()
  let bytes = 0
  let completed = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > budget) return { bytes, tally: null }
      splitter.push(value)
    }
    splitter.finish()
    completed = true
    return { bytes, tally }
  } finally {
    // Um stream que já falhou rejeita o cancel com o próprio erro; o erro
    // original é o que segue.
    if (!completed) await reader.cancel().catch(() => {})
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
  /** true quando o orçamento de bytes parou a leitura antes do último dia. */
  truncated: boolean
  malformedLines: number
  /** Bytes recebidos do R2, inclusive os do dia interrompido pelo orçamento. */
  bytesRead: number
}

/**
 * Agrega os NDJSON dos `days`, um arquivo por vez. Antes de consumir cada corpo
 * confere o tamanho declarado pelo R2 contra o que sobra do orçamento; durante
 * a leitura conta os bytes de fato recebidos. Passou do orçamento, para ali e
 * devolve os dias já lidos com `truncated: true`. Os agregados do dia
 * interrompido ficam de fora, e os bytes recebidos dele entram em `bytesRead`.
 *
 * Erro do R2 (no `get` ou no meio do stream) derruba a consulta, como antes do
 * streaming: a rota responde 500 e o corpo em leitura é cancelado.
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
    const read = await tallyBody(obj.body, maxBytes - bytesRead)
    bytesRead += read.bytes
    const tally = read.tally
    if (!tally) {
      truncated = true
      break
    }
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
