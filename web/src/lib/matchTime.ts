/**
 * Datas de jogo no fuso de Brasília, no formato do card e do cabeçalho da rodada
 * na aba Palpitar.
 */
const partsFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Sao_Paulo',
})

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Abaixo deste prazo, o fechamento aparece como tempo restante. */
export const RELATIVE_CLOSING_MS = 24 * HOUR_MS

function dateParts(iso: string) {
  const parts = new Map(partsFormat.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return {
    // O Intl abrevia com ponto ("sáb."). O card usa a forma curta sem ponto.
    weekday: (parts.get('weekday') ?? '').replace('.', ''),
    date: `${parts.get('day')}/${parts.get('month')}`,
    time: `${parts.get('hour')}:${parts.get('minute')}`,
  }
}

/** Data do card, como `sáb, 14/11 · 18:30`. */
export function formatMatchDate(iso: string): string {
  const { weekday, date, time } = dateParts(iso)
  return `${weekday}, ${date} · ${time}`
}

/** Só o dia, como `sáb, 14/11`. */
export function formatMatchDay(iso: string): string {
  const { weekday, date } = dateParts(iso)
  return `${weekday}, ${date}`
}

/** Fechamento por extenso, como `sáb, 14/11 às 18:30`. */
export function formatClosingDate(iso: string): string {
  const { weekday, date, time } = dateParts(iso)
  return `${weekday}, ${date} às ${time}`
}

/**
 * Tempo até o fechamento, como `2 h 15 min`, `45 min` ou `menos de 1 min`. Arredonda
 * para baixo para nunca prometer mais tempo do que resta.
 */
export function formatTimeLeft(ms: number): string {
  if (ms < MINUTE_MS) return 'menos de 1 min'
  const minutes = Math.floor(ms / MINUTE_MS)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/**
 * Quando o jogo fecha para palpite. A partir de 24 h vale a data com dia da
 * semana. Abaixo disso, o tempo que falta.
 */
export function closingText(startIso: string, nowMs: number): string {
  const left = Date.parse(startIso) - nowMs
  return left < RELATIVE_CLOSING_MS ? `em ${formatTimeLeft(left)}` : formatClosingDate(startIso)
}
