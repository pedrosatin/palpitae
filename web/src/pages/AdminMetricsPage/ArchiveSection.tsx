import { trackEvent } from '../../analytics/ga'
import { buildApiUrl } from '../../config'
import { apiFetch } from '../../lib/api'
import AdminPills from '../AdminPills'
import styles from './AdminMetricsPage.module.css'
import { BarChart } from './charts'
import { formatNumber } from './format'
import { eventLabel } from './labels'
import { KpiCard } from './KpiCard'
import type { buildArchiveDays, buildArchiveStats } from './overview'
import type { ArchiveFile, ArchiveQueryResponse } from './types'

function formatBytes(size: number): string {
  if (size === 0) return '0 B (vazio)'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function ArchiveDayCells({
  file,
  beforeFirstExport,
}: {
  file: ArchiveFile | null
  beforeFirstExport: boolean
}) {
  if (file) {
    return (
      <>
        <td className={styles.num}>{file.events ?? '—'}</td>
        <td className={styles.num}>{formatBytes(file.size)}</td>
      </>
    )
  }
  if (beforeFirstExport) {
    return (
      <td className={styles.num} colSpan={2}>
        —
      </td>
    )
  }
  return (
    <td className={`${styles.num} ${styles.statusError}`} colSpan={2}>
      faltando
    </td>
  )
}

export default function ArchiveSection({
  archiveStats,
  archiveDays,
}: {
  archiveStats: ReturnType<typeof buildArchiveStats> | null
  archiveDays: ReturnType<typeof buildArchiveDays>
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Arquivo frio (R2)</h2>
      {!archiveStats ? (
        <p className={styles.hint}>
          Nenhum arquivo no bucket — em dev local o R2 é simulado e começa vazio; em produção, ver
          se o cron de export (00:05 UTC) está rodando.
        </p>
      ) : (
        <>
          <div className={styles.kpiRow}>
            <KpiCard label="dias arquivados" value={formatNumber(archiveStats.totalDays)} />
            <KpiCard
              label="eventos arquivados"
              value={`${archiveStats.missingMeta > 0 ? '≥ ' : ''}${formatNumber(archiveStats.totalEvents)}`}
            />
            <KpiCard label="tamanho total" value={formatBytes(archiveStats.totalBytes)} />
            <KpiCard label="desde" value={archiveStats.oldestDay} />
          </div>

          <h3 className={styles.subTitle}>Eventos por mês · histórico completo</h3>
          <BarChart
            series={archiveStats.monthly}
            ariaLabel="Eventos arquivados por mês"
            unit=" eventos"
            tickLabel={(l) => `${l.slice(5, 7)}/${l.slice(2, 4)}`}
          />
          {archiveStats.missingMeta > 0 && (
            <p className={styles.hint}>
              {archiveStats.missingMeta}{' '}
              {archiveStats.missingMeta === 1 ? 'arquivo ainda sem' : 'arquivos ainda sem'} contagem
              de eventos (export antigo) — o cron re-grava a metadata aos poucos; até lá os totais
              acima são piso ("≥").
            </p>
          )}

          <h3 className={styles.subTitle}>Integridade · últimos 14 dias</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>dia</th>
                <th className={styles.num}>eventos</th>
                <th className={styles.num}>tamanho</th>
              </tr>
            </thead>
            <tbody>
              {archiveDays.map(({ day, file, beforeFirstExport }) => (
                <tr key={day}>
                  <td>{day}</td>
                  <ArchiveDayCells file={file} beforeFirstExport={beforeFirstExport} />
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.hint}>
            <strong>faltando</strong> = o export diário não gravou o NDJSON desse dia (cron falhou;
            o backfill re-tenta sozinho enquanto o dia estiver na janela de ~3 meses do Analytics
            Engine). "—" = dia anterior ao primeiro export.
          </p>
        </>
      )}
    </section>
  )
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export function ArchiveQuerySection({
  months,
  selected,
  loading,
  result,
  onSelect,
}: {
  months: { label: string; total: number }[]
  selected: string | null
  loading: boolean
  result: ArchiveQueryResponse | null
  onSelect: (month: string) => void
}) {
  if (months.length === 0) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Análise do arquivo (além da janela do AE)</h2>
      <p className={styles.hint}>
        Lê o corpo dos NDJSON de um mês e agrega por tipo — enxerga dados que já saíram dos ~3 meses
        do Analytics Engine.
      </p>
      <AdminPills
        options={months.map((m) => ({ value: m.label, label: m.label }))}
        value={selected}
        ariaLabel="Mês do arquivo"
        onChange={(month) => {
          trackEvent('click_admin_metrics_arquivo_mes', { month })
          onSelect(month)
        }}
      />

      {loading && <p className={styles.hint}>Lendo arquivos…</p>}

      {result && !loading && (
        <>
          <p className={styles.hint}>
            {result.from} a {result.to} · {result.filesRead} arquivo(s) ·{' '}
            <strong>{result.totalEvents}</strong> eventos
          </p>
          {result.truncated && (
            <p className={styles.hint}>
              Resultado parcial: a leitura parou no teto de bytes
              {result.daysRead?.length ? ` depois de ${result.daysRead.at(-1)}` : ''}.
            </p>
          )}
          {(result.malformedLines ?? 0) > 0 && (
            <p className={styles.hint}>
              {result.malformedLines} linha(s) malformada(s) ignorada(s).
            </p>
          )}
          {result.byType.length === 0 ? (
            <p className={styles.hint}>
              {result.truncated
                ? 'Nenhum evento nos dias incluídos no resultado.'
                : 'Nenhum evento arquivado nesse mês.'}
            </p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {result.byType.map((t) => (
                  <tr key={t.event_type}>
                    <td title={t.event_type}>{eventLabel(t.event_type)}</td>
                    <td className={styles.num}>{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}

/** GET /metrics/archive/query de um mês. Falha vira null: o mês fica sem resultado. */
export async function loadArchiveQuery(month: string): Promise<ArchiveQueryResponse | null> {
  try {
    const res = await apiFetch(
      buildApiUrl('/metrics/archive/query', new URLSearchParams(monthBounds(month))),
    )
    return res.ok ? ((await res.json()) as ArchiveQueryResponse) : null
  } catch {
    return null
  }
}
