import styles from './AdminMetricsPage.module.css'

export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
      {hint && <span className={styles.kpiHint}>{hint}</span>}
    </div>
  )
}
