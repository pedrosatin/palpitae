import styles from './AdminMetricsPage.module.css'

/**
 * Gráficos SVG do dashboard admin — sem lib de chart de propósito (página de
 * 1 usuário não justifica dependência no bundle).
 */

/** Paleta para séries por tipo de evento (contraste ok no fundo escuro). */
export const SERIES_COLORS = [
  '#49f21b', // verde (brand)
  '#4dabf7', // azul
  '#ffd43b', // amarelo
  '#ff8787', // vermelho
  '#b197fc', // roxo
  '#63e6be', // teal
  '#ffa94d', // laranja
  '#f783ac', // rosa
] as const

/** Cor do agrupamento "outros" quando há mais tipos que cores. */
export const OTHER_COLOR = '#868e96'

export interface StackedDay {
  label: string
  segments: { type: string; value: number; color: string }[]
}

const WIDTH = 720
const HEIGHT = 180

/** Barras empilhadas por dia — um segmento colorido por tipo de evento. */
export function StackedBarChart({ days, ariaLabel }: { days: StackedDay[]; ariaLabel: string }) {
  const max = Math.max(1, ...days.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)))
  const barW = WIDTH / Math.max(1, days.length)

  return (
    <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
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
                  <title>{`${d.label} · ${s.type}: ${s.value}`}</title>
                </rect>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

/** Barras simples de uma série só (ex.: chamadas à API Football por dia). */
export function BarChart({
  series,
  ariaLabel,
  unit = '',
}: {
  series: { label: string; total: number }[]
  ariaLabel: string
  unit?: string
}) {
  const max = Math.max(1, ...series.map((s) => s.total))
  const barW = WIDTH / Math.max(1, series.length)

  return (
    <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
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
    </svg>
  )
}
