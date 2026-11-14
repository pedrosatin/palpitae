import { formatSince, isNewerThanPeriod } from './format'
import styles from './AdminMetricsPage.module.css'

/** Avisa quando a coleta de uma dimensão começou depois do início do período. */
export function CollectionNotice({
  subject,
  since,
  days,
}: {
  subject: string
  since: string | null
  days: number
}) {
  if (!since) {
    return (
      <p className={styles.samplingWarning}>
        {subject}: nenhum registro ainda. A coleta é recente ou o deploy não chegou ao Worker. Isso
        é falta de dado, não zero.
      </p>
    )
  }
  if (isNewerThanPeriod(since, days)) {
    return (
      <p className={styles.samplingWarning}>
        {subject}: a coleta começou em {formatSince(since)}; antes disso não há dados.
      </p>
    )
  }
  return null
}
