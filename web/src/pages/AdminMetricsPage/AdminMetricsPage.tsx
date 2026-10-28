import { useEffect, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { buildApiUrl } from '../../config'
import { apiFetch } from '../../lib/api'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import ErrorState from '../../components/ErrorState'
import AdminPageShell from '../AdminPageShell'
import shared from '../admin-shared.module.css'
import styles from './AdminMetricsPage.module.css'
import { BarChart, StackedBarChart } from './charts'
import { eventLabel } from './labels'
import { ArchiveQueryResponse, ArchiveResponse, BusinessResponse, OverviewResponse } from './types'
import { useMetricsData, CRON_INFO, isStale } from './useMetricsData'

/**
 * Dashboard admin de métricas server-side (Analytics Engine + R2).
 *
 * Consome GET /metrics/overview e /metrics/archive — a API é quem fala com a
 * SQL API do Analytics Engine (token de conta nunca chega ao cliente). Acesso
 * restrito ao ADMIN_EMAIL; para qualquer outro usuário a API responde 403 e a
 * página mostra "acesso restrito". Não há link de navegação — URL direta.
 */

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR')
}

function formatBytes(size: number): string {
  if (size === 0) return '0 B (vazio)'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatTimestamp(ts: string): string {
  // SQL API devolve "YYYY-MM-DD hh:mm:ss" (UTC) — encurta pra dd/mm hh:mm.
  const [date, time] = ts.split(' ')
  if (!date || !time) return ts
  const [, m, d] = date.split('-')
  return `${d}/${m} ${time.slice(0, 5)}`
}

/** Duração legível: ms cru até 1 s, segundos até 1 min, depois minutos. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

/** "há X min/h/dias" a partir de um timestamp UTC da SQL API. */
function formatAgo(ts: string): string {
  const date = new Date(`${ts.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return ts
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000))
  if (mins < 60) return `há ${mins} min`
  if (mins < 48 * 60) return `há ${Math.round(mins / 60)} h`
  return `há ${Math.round(mins / (24 * 60))} dias`
}

/**
 * Pulso dos crons: nome amigável + limite de "atrasado" (minutos). Última
 * execução além do limite pinta de vermelho — cron provavelmente parado.
 */
function KpiCard({
  label,
  value,
  hint,
  status,
}: {
  label: string
  value: string
  hint?: string
  /** Cor do valor conforme severidade — 'ok' (default) é o verde de marca. */
  status?: 'ok' | 'warn' | 'danger'
}) {
  const valueClass =
    status === 'danger'
      ? `${styles.kpiValue} ${styles.kpiValueDanger}`
      : status === 'warn'
        ? `${styles.kpiValue} ${styles.kpiValueWarn}`
        : styles.kpiValue
  return (
    <div className={styles.kpi}>
      <span className={valueClass}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
      {hint && <span className={styles.kpiHint}>{hint}</span>}
    </div>
  )
}

function StatusStrip({
  alerts,
}: {
  alerts: { key: string; label: string; level: 'warn' | 'danger' }[]
}) {
  if (alerts.length === 0) {
    return (
      <div className={styles.statusStrip}>
        <span className={`${styles.statusChip} ${styles.statusChipOk}`}>Tudo normal</span>
      </div>
    )
  }
  return (
    <div className={styles.statusStrip}>
      {alerts.map((a) => (
        <span
          key={a.key}
          className={`${styles.statusChip} ${a.level === 'danger' ? styles.statusChipDanger : styles.statusChipWarn}`}
        >
          {a.level === 'danger' ? '●' : '▲'} {a.label}
        </span>
      ))}
    </div>
  )
}

function OverviewKpisRow({
  kpis,
}: {
  kpis: {
    activeUsers: number
    predictions: number
    groupsCreated: number
    joinRate: string
    logins: number
    cacheHitRate: string
  }
}) {
  return (
    <div className={styles.kpiRow}>
      <KpiCard label="usuários palpitando" value={formatNumber(kpis.activeUsers)} />
      <KpiCard label="palpites salvos" value={formatNumber(kpis.predictions)} />
      <KpiCard label="grupos criados" value={formatNumber(kpis.groupsCreated)} />
      <KpiCard label="entradas por grupo" value={kpis.joinRate} hint="conversão de convite" />
      <KpiCard label="logins" value={formatNumber(kpis.logins)} />
      <KpiCard label="cache hit" value={kpis.cacheHitRate} hint="GET /matches" />
    </div>
  )
}

function BusinessSection({ business }: { business: BusinessResponse }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Visão geral do produto</h2>
      <div className={styles.kpiRow}>
        <KpiCard
          label="usuários"
          value={formatNumber(business.usersTotal)}
          hint="total, lifetime"
        />
        <KpiCard
          label="usuários em algum grupo"
          value={formatNumber(business.usersInGroup)}
          hint="lifetime"
        />
        <KpiCard
          label="usuários que já palpitaram"
          value={formatNumber(business.usersWhoPredicted)}
          hint="lifetime"
        />
        <KpiCard
          label="contas criadas"
          value={formatNumber(business.usersCreatedInPeriod)}
          hint={`últimos ${business.days}d`}
        />
        <KpiCard
          label="grupos criados"
          value={formatNumber(business.groupsCreatedInPeriod)}
          hint={`últimos ${business.days}d`}
        />
        <KpiCard
          label="grupos por usuário"
          value={business.avgGroupsPerUser.toFixed(1)}
          hint={`mediana ${business.medianGroupsPerUser}`}
        />
      </div>

      <h3 className={styles.subTitle}>Campeonatos com mais grupos ativos</h3>
      {business.topCompetitions.length === 0 ? (
        <p className={styles.hint}>Nenhum grupo ativo.</p>
      ) : (
        <div>
          {business.topCompetitions.map((c) => {
            const max = business.topCompetitions[0].groups
            const pct = max > 0 ? Math.round((c.groups / max) * 100) : 0
            return (
              <div key={c.competition} className={styles.miniBarRow}>
                <span className={styles.miniBarLabel} title={c.competition}>
                  {c.competition}
                </span>
                <span className={styles.miniBarTrack}>
                  <span className={styles.miniBarFill} style={{ width: `${pct}%` }} />
                </span>
                <span className={styles.miniBarValue}>{formatNumber(c.groups)}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function EventsSection({
  overview,
  stacked,
}: {
  overview: OverviewResponse
  stacked: ReturnType<typeof useMetricsData>['stacked']
}) {
  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Eventos por dia · últimos {overview.days} dias</h2>
        <StackedBarChart days={stacked.series} ariaLabel="Eventos por dia, por tipo" />
        <div className={styles.legend}>
          {stacked.legend.map((l) => (
            <span key={l.type} className={styles.legendItem} title={l.type}>
              <span className={styles.legendDot} style={{ backgroundColor: l.color }} />
              {eventLabel(l.type)}
            </span>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Totais por evento</h2>
        {overview.totals.length === 0 ? (
          <p className={styles.hint}>Nenhum evento no período.</p>
        ) : (
          <table className={styles.table}>
            <tbody>
              {overview.totals.map((t) => (
                <tr key={t.event_type}>
                  {/* title mantém o event_type cru — é a chave do esquema
                      posicional em docs/observability.md */}
                  <td title={t.event_type}>{eventLabel(t.event_type)}</td>
                  <td className={styles.num}>{formatNumber(Number(t.count))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

function HealthSection({
  overview,
  apiCallsSeries,
}: {
  overview: OverviewResponse
  apiCallsSeries: ReturnType<typeof useMetricsData>['apiCallsSeries']
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Saúde dos crons</h2>
      {overview.lastRuns.length === 0 ? (
        <p className={styles.hint}>Nenhuma execução de cron no período. ⚠️</p>
      ) : (
        <table className={styles.table}>
          <tbody>
            {overview.lastRuns.map((r) => {
              const info = CRON_INFO[r.event_type]
              const stale = info ? isStale(r.last_run, info.staleAfterMin) : false
              return (
                <tr key={r.event_type}>
                  <td>{info?.label ?? r.event_type}</td>
                  <td className={`${styles.num} ${stale ? styles.statusError : ''}`}>
                    {formatAgo(r.last_run)}
                    {stale && ' ⚠️'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <h3 className={styles.subTitle}>Poller de resultados</h3>
      {overview.poller.length === 0 ? (
        <p className={styles.hint}>Nenhuma execução no período.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>status</th>
              <th className={styles.num}>execuções</th>
              <th className={styles.num}>duração média</th>
              <th className={styles.num}>duração máx.</th>
            </tr>
          </thead>
          <tbody>
            {overview.poller.map((p) => (
              <tr key={p.status}>
                <td className={p.status === 'error' ? styles.statusError : styles.statusOk}>
                  {p.status}
                </td>
                <td className={styles.num}>{formatNumber(Number(p.runs))}</td>
                <td className={styles.num}>{formatDuration(Number(p.avg_duration_ms))}</td>
                <td className={styles.num}>{formatDuration(Number(p.max_duration_ms))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className={styles.subTitle}>Chamadas à API Football por dia</h3>
      <BarChart
        series={apiCallsSeries}
        ariaLabel="Chamadas à API Football por dia"
        unit=" chamadas"
      />
    </section>
  )
}

function EngagementSection({
  dauSeries,
}: {
  dauSeries: ReturnType<typeof useMetricsData>['dauSeries']
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Usuários ativos (palpitando) por dia</h2>
      <BarChart series={dauSeries} ariaLabel="Usuários palpitando por dia" unit=" usuários" />
      <p className={styles.hint}>
        Distintos por <code>prediction_saved</code> — sob amostragem do Analytics Engine é piso.
      </p>
    </section>
  )
}

function LatencySection({ overview }: { overview: OverviewResponse }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Latência por rota</h2>
      {overview.latency.length === 0 ? (
        <p className={styles.hint}>Nenhuma medida de latência no período.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>rota</th>
              <th className={styles.num}>requests</th>
              <th className={styles.num}>média</th>
              <th className={styles.num}>máx.</th>
              <th className={styles.num}>db médio</th>
            </tr>
          </thead>
          <tbody>
            {overview.latency.map((r) => (
              <tr key={r.route}>
                <td className={styles.nowrap}>{r.route}</td>
                <td className={styles.num}>{formatNumber(Number(r.requests))}</td>
                <td className={styles.num}>{formatDuration(Number(r.avg_ms))}</td>
                <td className={styles.num}>{formatDuration(Number(r.max_ms))}</td>
                <td className={styles.num}>{formatDuration(Number(r.avg_db_ms))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function EmailSection({
  overview,
  kpis,
}: {
  overview: OverviewResponse
  kpis: { emailUnsubs: number; emailResubs: number }
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>E-mail de lembrete</h2>
      <table className={styles.table}>
        <tbody>
          <tr>
            <td>rodadas lembradas (cron)</td>
            <td className={styles.num}>{formatNumber(Number(overview.emailHealth.rounds))}</td>
          </tr>
          <tr>
            <td>e-mails enviados</td>
            <td className={styles.num}>{formatNumber(Number(overview.emailHealth.sent))}</td>
          </tr>
          <tr>
            <td>falhas de envio</td>
            <td
              className={`${styles.num} ${Number(overview.emailHealth.failed) > 0 ? styles.statusError : ''}`}
            >
              {formatNumber(Number(overview.emailHealth.failed))}
            </td>
          </tr>
          <tr>
            <td>descadastros</td>
            <td className={styles.num}>{kpis.emailUnsubs}</td>
          </tr>
          <tr>
            <td>recadastros</td>
            <td className={styles.num}>{kpis.emailResubs}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function ConcentrationSection({
  whaleShare,
}: {
  whaleShare: { top1: number; top5: number } | null
}) {
  if (!whaleShare) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Concentração de palpites</h2>
      <p className={styles.hint}>
        Maior palpiteiro: <strong>{whaleShare.top1}%</strong> dos palpites · top 5:{' '}
        <strong>{whaleShare.top5}%</strong> — quanto mais alto, mais a retenção depende de poucos
        usuários hardcore.
      </p>
    </section>
  )
}

function LoginFailuresSection({ overview }: { overview: OverviewResponse }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Falhas de login por motivo</h2>
      {overview.loginFailures.length === 0 ? (
        <p className={styles.hint}>Nenhuma falha no período. 🎉</p>
      ) : (
        <table className={styles.table}>
          <tbody>
            {overview.loginFailures.map((f) => (
              <tr key={f.reason}>
                <td>{f.reason}</td>
                <td className={styles.num}>{formatNumber(Number(f.count))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function RecentErrorsSection({ overview }: { overview: OverviewResponse }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Erros recentes</h2>
      {overview.recentErrors.length === 0 ? (
        <p className={styles.hint}>Nenhum erro no período. 🎉</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>quando (UTC)</th>
              <th>evento</th>
              <th>detalhe</th>
            </tr>
          </thead>
          <tbody>
            {overview.recentErrors.map((e, i) => (
              <tr key={`${e.timestamp}-${i}`}>
                <td className={styles.nowrap}>{formatTimestamp(e.timestamp)}</td>
                <td className={styles.nowrap} title={e.event_type}>
                  {eventLabel(e.event_type)}
                </td>
                {/* blobs posicionais variam por tipo de evento — mostra cru */}
                <td className={styles.detail}>
                  {[e.blob2, e.blob3, e.blob4].filter(Boolean).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function ArchiveSection({
  archiveStats,
  archiveDays,
}: {
  archiveStats: ReturnType<typeof useMetricsData>['archiveStats']
  archiveDays: ReturnType<typeof useMetricsData>['archiveDays']
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
                  {file ? (
                    <>
                      <td className={styles.num}>{file.events ?? '—'}</td>
                      <td className={styles.num}>{formatBytes(file.size)}</td>
                    </>
                  ) : beforeFirstExport ? (
                    <td className={styles.num} colSpan={2}>
                      —
                    </td>
                  ) : (
                    <td className={`${styles.num} ${styles.statusError}`} colSpan={2}>
                      faltando
                    </td>
                  )}
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

/** Bounds UTC de um mês "YYYY-MM": primeiro e último dia (YYYY-MM-DD). */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

function ArchiveQuerySection({
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
      <div className={shared.periods}>
        {months.map((m) => (
          <button
            key={m.label}
            type="button"
            className={m.label === selected ? shared.periodActive : shared.period}
            onClick={() => {
              trackEvent('click_admin_metrics_arquivo_mes', { month: m.label })
              onSelect(m.label)
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading && <p className={styles.hint}>Lendo arquivos…</p>}

      {result && !loading && (
        <>
          <p className={styles.hint}>
            {result.from} a {result.to} · {result.filesRead} arquivo(s) ·{' '}
            <strong>{result.totalEvents}</strong> eventos
          </p>
          {result.byType.length === 0 ? (
            <p className={styles.hint}>Nenhum evento arquivado nesse mês.</p>
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

export default function AdminMetricsPage() {
  useDocumentTitle('Métricas')

  const [days, setDays] = useState<number>(30)
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [business, setBusiness] = useState<BusinessResponse | null>(null)
  const [archive, setArchive] = useState<ArchiveResponse | null>(null)
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null)
  const [loading, setLoading] = useState(true)

  // Análise do arquivo frio, sob demanda (um mês por vez) — independente do período.
  const [queryMonth, setQueryMonth] = useState<string | null>(null)
  const [queryResult, setQueryResult] = useState<ArchiveQueryResponse | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ days: String(days) })
    Promise.all([
      apiFetch(buildApiUrl('/metrics/overview', params)),
      apiFetch(buildApiUrl('/metrics/business', params)),
      apiFetch(buildApiUrl('/metrics/archive')),
    ])
      .then(async ([ovRes, bizRes, arRes]) => {
        if (cancelled) return
        if (ovRes.status === 403) {
          setError('forbidden')
          return
        }
        if (!ovRes.ok) throw new Error(`overview ${ovRes.status}`)
        setOverview((await ovRes.json()) as OverviewResponse)
        // Negócio e arquivo são secundários — falha neles não derruba a página inteira.
        if (bizRes.ok) setBusiness((await bizRes.json()) as BusinessResponse)
        if (arRes.ok) setArchive((await arRes.json()) as ArchiveResponse)
      })
      .catch(() => {
        if (!cancelled) setError('failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [days])

  const {
    stacked,
    apiCallsSeries,
    dauSeries,
    kpis,
    avgSample,
    isSampling,
    whaleShare,
    alerts,
    archiveDays,
    archiveStats,
  } = useMetricsData(overview, archive)

  async function runArchiveQuery(month: string) {
    setQueryMonth(month)
    setQueryLoading(true)
    setQueryResult(null)
    const { from, to } = monthBounds(month)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await apiFetch(buildApiUrl('/metrics/archive/query', params))
      if (res.ok) setQueryResult((await res.json()) as ArchiveQueryResponse)
    } catch {
      // Falha na análise não derruba a página — o mês fica sem resultado.
    } finally {
      setQueryLoading(false)
    }
  }

  return (
    <AdminPageShell
      title="Métricas"
      days={days}
      onDaysChange={setDays}
      periodEventName="click_admin_metrics_periodo"
      forbidden={error === 'forbidden'}
      contentClassName={styles.content}
    >
      <>
        {error === 'failed' && (
          <ErrorState message="Falha ao carregar as métricas. Tente de novo." />
        )}

        {loading && <p className={styles.hint}>Carregando…</p>}

        {overview && kpis && !loading && (
          <>
            <StatusStrip alerts={alerts} />

            <OverviewKpisRow kpis={kpis} />

            {isSampling && (
              <p className={styles.samplingWarning}>
                ⚠️ Analytics Engine está amostrando (média de _sample_interval ={' '}
                {avgSample.toFixed(2)}) — os números do período são estimativa e o volume de eventos
                merece atenção.
              </p>
            )}

            {business && <BusinessSection business={business} />}

            <EventsSection overview={overview} stacked={stacked} />
            <EngagementSection dauSeries={dauSeries} />
            <HealthSection overview={overview} apiCallsSeries={apiCallsSeries} />
            <LatencySection overview={overview} />
            <EmailSection overview={overview} kpis={kpis} />
            <ConcentrationSection whaleShare={whaleShare} />
            <LoginFailuresSection overview={overview} />
            <RecentErrorsSection overview={overview} />
          </>
        )}

        {archive && !loading && (
          <>
            <ArchiveSection archiveStats={archiveStats} archiveDays={archiveDays} />
            <ArchiveQuerySection
              months={archiveStats?.monthly ?? []}
              selected={queryMonth}
              loading={queryLoading}
              result={queryResult}
              onSelect={runArchiveQuery}
            />
          </>
        )}
      </>
    </AdminPageShell>
  )
}
