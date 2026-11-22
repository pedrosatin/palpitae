import styles from './AdminMetricsPage.module.css'
import { eventLabel } from './labels'


/** Paleta para séries por tipo de evento (contraste ok no fundo escuro). */
export const SERIES_COLORS = [
  '#49f21b',
  '#4dabf7',
  '#ffd43b',
  '#ff8787',
  '#b197fc',
  '#63e6be',
  '#ffa94d',
  '#f783ac',
] as const

/** Cor do agrupamento "outros" quando há mais tipos que cores. */
export const OTHER_COLOR = '#868e96'

export interface StackedDay {
  label: string
  segments: { type: string; value: number; color: string }[]
}

const WIDTH = 720
const HEIGHT = 180
const AXIS_HEIGHT = 16

function shortDate(label: string): string {
  return `${label.slice(8, 10)}/${label.slice(5, 7)}`
}

function tickIndexes(count: number): Set<number> {
  const step = count <= 10 ? 1 : Math.ceil(count / 7)
  const ticks = new Set<number>()
  for (let i = 0; i < count; i += step) ticks.add(i)
  const last = count - 1
  for (const t of ticks) {
    if (t !== last && last - t < step / 2) ticks.delete(t)
  }
  ticks.add(last)
  return ticks
}

function XAxis({ labels, format }: { labels: string[]; format: (label: string) => string }) {
  const barW = WIDTH / Math.max(1, labels.length)
  const ticks = tickIndexes(labels.length)
  return (
    <>
      {labels.map((label, i) =>
        ticks.has(i) ? (
          <text
            key={label}
            className={styles.axisLabel}
            x={i * barW + barW / 2}
            y={HEIGHT + AXIS_HEIGHT - 4}
            textAnchor="middle"
          >
            {format(label)}
          </text>
        ) : null,
      )}
    </>
  )
}

/** Barras empilhadas por dia — um segmento colorido por tipo de evento (ou série). */
export function StackedBarChart({
  days,
  ariaLabel,
  segmentLabel = eventLabel,
}: {
  days: StackedDay[]
  ariaLabel: string
  segmentLabel?: (type: string) => string
}) {
  const max = Math.max(1, ...days.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)))
  const barW = WIDTH / Math.max(1, days.length)

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${WIDTH} ${HEIGHT + AXIS_HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
    >
      {days.map((d, i) => {
        let y = HEIGHT
        return (
          <g key={d.label}>
            {d.segments.map((s) => {
              const h = (s.value / max) * (HEIGHT - 20)
              y -= h
              return (
                <rect
                  key={s.type}
                  className={styles.bar}
                  x={i * barW + 1}
                  y={y}
                  width={Math.max(1, barW - 2)}
                  height={h}
                  fill={s.color}
                >
                  <title>{`${d.label} · ${segmentLabel(s.type)}: ${s.value}`}</title>
                </rect>
              )
            })}
          </g>
        )
      })}
      <XAxis labels={days.map((d) => d.label)} format={shortDate} />
    </svg>
  )
}

/** Barras simples de uma série só (ex.: chamadas à API Football por dia). */
export function BarChart({
  series,
  ariaLabel,
  unit = '',
  tickLabel = shortDate,
}: {
  series: { label: string; total: number }[]
  ariaLabel: string
  unit?: string
  tickLabel?: (label: string) => string
}) {
  const max = Math.max(1, ...series.map((s) => s.total))
  const barW = WIDTH / Math.max(1, series.length)

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${WIDTH} ${HEIGHT + AXIS_HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
    >
      {series.map((s, i) => {
        const h = Math.round((s.total / max) * (HEIGHT - 20))
        return (
          <rect
            key={s.label}
            className={styles.barPrimary}
            x={i * barW + 1}
            y={HEIGHT - h}
            width={Math.max(1, barW - 2)}
            height={h}
          >
            <title>{`${s.label}: ${s.total}${unit}`}</title>
          </rect>
        )
      })}
      <XAxis labels={series.map((s) => s.label)} format={tickLabel} />
    </svg>
  )
}

export interface ChartLegendItem {
  key: string
  color: string
  label: string
  title?: string
}

/** Legenda de cores compartilhada pelos gráficos de barras empilhadas. */
export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  return (
    <div className={styles.legend}>
      {items.map((item) => (
        <span key={item.key} className={styles.legendItem} title={item.title}>
          <span className={styles.legendDot} style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
