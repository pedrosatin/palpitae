import styles from './AdminRadarPage.module.css'

/**
 * Sparkline do interesse diário — a forma da curva importa mais que os valores
 * (torneio em alta sobe; torneio parado achata), por isso não tem eixo nem
 * rótulo. SVG puro, como o resto do admin: uma página de 1 usuário não
 * justifica lib de chart no bundle.
 */

const WIDTH = 72
const HEIGHT = 20

export function Sparkline({ series }: { series: { day: string; views: number | null }[] }) {
  const points = series.filter((p) => p.views !== null) as { day: string; views: number }[]
  if (points.length < 2) return null

  const max = Math.max(...points.map((p) => p.views))
  const min = Math.min(...points.map((p) => p.views))
  const span = max - min || 1

  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * WIDTH
      // Y invertido (SVG cresce pra baixo) e com 1px de folga nas bordas pra
      // linha não ser cortada no topo/base.
      const y = HEIGHT - 1 - ((p.views - min) / span) * (HEIGHT - 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Variação diária: mínimo ${min}, máximo ${max}`}
    >
      <path d={path} fill="none" strokeWidth={1.5} />
    </svg>
  )
}
