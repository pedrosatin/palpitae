import { formatCount, formatSince } from './format'
import styles from './AdminMetricsPage.module.css'


type QuotaMetric = 'd1_rows_read' | 'd1_rows_written' | 'worker_requests'

export interface QuotaUsageResponse {
  latest: {
    day: string | null
    measuredAt: string
    metrics: {
      metric: QuotaMetric
      used: number
      limit: number
      percent: number
      threshold: 50 | 80 | null
    }[]
  } | null
}

const METRIC_LABELS: Record<QuotaMetric, string> = {
  d1_rows_read: 'linhas lidas do D1',
  d1_rows_written: 'linhas escritas do D1',
  worker_requests: 'requisições dos Workers',
}

function isQuotaUsage(data: QuotaUsageResponse | null): data is QuotaUsageResponse {
  if (typeof data !== 'object' || data === null || !('latest' in data)) return false
  const { latest } = data
  if (latest === null) return true
  return typeof latest === 'object' && latest !== undefined && Array.isArray(latest.metrics)
}

function formatDay(day: string): string {
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

function formatPercent(percent: number): string {
  return `${percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function percentClass(threshold: 50 | 80 | null): string | undefined {
  if (threshold === 80) return styles.statusError
  if (threshold === 50) return styles.statusWarn
  return undefined
}

export default function QuotaUsageSection({ data }: { data: QuotaUsageResponse | null }) {
  if (!isQuotaUsage(data)) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cotas do plano Free</h2>
        <p className={styles.hint}>Indisponível: a API ainda não envia o uso das cotas.</p>
      </section>
    )
  }

  const { latest } = data
  if (!latest) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cotas do plano Free</h2>
        <p className={styles.hint}>
          Nenhuma medição ainda. O cron das 00:05 UTC mede o dia anterior quando o
          CF_ANALYTICS_TOKEN está cadastrado no Worker.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Cotas do plano Free{latest.day ? ` · ${formatDay(latest.day)} (UTC)` : ''}
      </h2>
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="Uso das cotas do plano Free">
          <thead>
            <tr>
              <th>métrica</th>
              <th className={styles.num}>uso no dia</th>
              <th className={styles.num}>cota diária</th>
              <th className={styles.num}>% da cota</th>
            </tr>
          </thead>
          <tbody>
            {latest.metrics.map((m) => (
              <tr key={m.metric}>
                <td>{METRIC_LABELS[m.metric] ?? m.metric}</td>
                <td className={styles.num}>{formatCount(m.used)}</td>
                <td className={styles.num}>{formatCount(m.limit)}</td>
                <td className={`${styles.num} ${percentClass(m.threshold) ?? ''}`.trim()}>
                  {formatPercent(m.percent)}
                  {m.threshold !== null && ` · a partir de ${m.threshold}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.hint}>
        Medido em {formatSince(latest.measuredAt)}. Soma da conta inteira. Uso acima de 50% de uma
        cota por 3 dias seguidos é o gatilho para migrar ao Workers Paid (ADR-022).
      </p>
    </section>
  )
}
