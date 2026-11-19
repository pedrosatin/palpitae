import { useEffect, useMemo, useRef, useState } from 'react'
import { buildApiUrl } from '../../config'
import { apiFetch } from '../../lib/api'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import AdminPageShell, { AdminLoadError } from '../AdminPageShell'
import { useAdminLoad, type AdminLoad } from '../useAdminLoad'
import styles from './AdminMetricsPage.module.css'
import ArchiveSection, { ArchiveQuerySection, loadArchiveQuery } from './ArchiveSection'
import BusinessSection from './BusinessSection'
import { BarChart, ChartLegend, StackedBarChart } from './charts'
import { formatNumber, parseSqlUtc } from './format'
import { KpiCard } from './KpiCard'
import { eventLabel } from './labels'
import {
  buildAlerts,
  buildArchiveDays,
  buildArchiveStats,
  buildKpis,
  buildStackedSeries,
  buildWhaleShare,
  CRON_INFO,
  dailyTotals,
  isStale,
} from './overview'
import CompetitionActivitySection, {
  type CompetitionActivityResponse,
} from './CompetitionActivitySection'
import HeatmapSection, { type HeatmapResponse } from './HeatmapSection'
import InviteFunnelSection, { type InviteFunnelResponse } from './InviteFunnelSection'
import SignupOriginsSection, { type SignupOriginsResponse } from './SignupOriginsSection'
import QuotaUsageSection, { type QuotaUsageResponse } from './QuotaUsageSection'
import ProviderOpsSection, { type CompetitionNames, type OpsResponse } from './ProviderOpsSection'
import type {
  ArchiveQueryResponse,
  ArchiveResponse,
  BusinessResponse,
  MetricsAlert,
  OverviewResponse,
} from './types'

/**
 * Dashboard admin de métricas server-side (Analytics Engine + R2).
 *
 * Consome GET /metrics/overview e /metrics/archive — a API é quem fala com a
 * SQL API do Analytics Engine (token de conta nunca chega ao cliente). Acesso
 * restrito ao ADMIN_EMAIL; para qualquer outro usuário a API responde 403 e a
 * página mostra "acesso restrito". Não há link de navegação — URL direta.
 */

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
  const time = parseSqlUtc(ts)
  if (Number.isNaN(time)) return ts
  const mins = Math.max(0, Math.round((Date.now() - time) / 60_000))
  if (mins < 60) return `há ${mins} min`
  if (mins < 48 * 60) return `há ${Math.round(mins / 60)} h`
  return `há ${Math.round(mins / (24 * 60))} dias`
}

function useMetricsData(
  overview: OverviewResponse | null,
  archive: ArchiveResponse | null,
  ops: OpsResponse | null,
  business: BusinessResponse | null,
) {
  const stacked = useMemo(
    () =>
      overview
        ? buildStackedSeries(overview.daily, overview.totals, overview.days)
        : { series: [], legend: [] },
    [overview],
  )

  const apiCallsSeries = useMemo(
    () =>
      overview
        ? dailyTotals(overview.apiCallsDaily, (r) => Number(r.api_calls), overview.days)
        : [],
    [overview],
  )

  // DAU: usuários distintos palpitando por dia.
  const dauSeries = useMemo(
    () =>
      overview ? dailyTotals(overview.predictionsDaily, (r) => Number(r.users), overview.days) : [],
    [overview],
  )

  const kpis = useMemo(() => (overview ? buildKpis(overview) : null), [overview])

  // Sampling do AE: média > 1 significa amostragem — números viram estimativa.
  const avgSample = overview ? Number(overview.sampling.avg_sample_interval ?? 1) : 1
  const isSampling = avgSample > 1.01

  const whaleShare = useMemo(
    () => (overview && kpis ? buildWhaleShare(overview, kpis.predictions) : null),
    [overview, kpis],
  )

  const alerts = useMemo(
    () => (overview ? buildAlerts(overview, ops, business) : []),
    [overview, ops, business],
  )

  const archiveFiles = archive && archive.files.length > 0 ? archive.files : null

  const archiveDays = useMemo(
    () => (archiveFiles ? buildArchiveDays(archiveFiles) : []),
    [archiveFiles],
  )

  const archiveStats = useMemo(
    () => (archiveFiles ? buildArchiveStats(archiveFiles) : null),
    [archiveFiles],
  )

  return {
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
  }
}

function StatusStrip({ alerts }: { alerts: MetricsAlert[] }) {
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
        <ChartLegend
          items={stacked.legend.map((l) => ({
            key: l.type,
            color: l.color,
            label: eventLabel(l.type),
            title: l.type,
          }))}
        />
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
      <p className={styles.hint}>
        O alerta do topo usa a proporção falhas / (login_success + login_failure) na
        janela selecionada, com volume mínimo. oauth_error, abandono e callbacks que
        nunca chegaram ficam fora do denominador. Inspecione cada motivo (incluindo
        state_mismatch) e reavalie; o limiar é heurística. Detalhes em
        docs/observability.md.
      </p>
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

/** Corpo de uma seção opcional: rede, status de erro ou JSON inválido viram null. */
async function optionalJson<T>(res: Response | null): Promise<T | null> {
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null
}

/** Tudo o que a página mostra para um período, lido de uma vez. */
interface MetricsSnapshot {
  overview: OverviewResponse
  business: BusinessResponse | null
  archive: ArchiveResponse | null
  ops: OpsResponse | null
  activity: CompetitionActivityResponse | null
  heatmap: HeatmapResponse | null
  inviteFunnel: InviteFunnelResponse | null
  signupOrigins: SignupOriginsResponse | null
  quota: QuotaUsageResponse | null
}

/** Nada carregado: período em carga, com falha ou sem acesso. */
const NO_METRICS: { [K in keyof MetricsSnapshot]: null } = {
  overview: null,
  business: null,
  archive: null,
  ops: null,
  activity: null,
  heatmap: null,
  inviteFunnel: null,
  signupOrigins: null,
  quota: null,
}

/**
 * Lê todas as seções do período. Não lança: 403 do overview vira `forbidden`,
 * qualquer outra falha do overview (ou corpo inválido de negócio/arquivo) vira
 * `failed`. Seção secundária que falha fica null, nunca com o dado de outro período.
 */
async function loadMetrics(days: number): Promise<AdminLoad<MetricsSnapshot>> {
  const params = new URLSearchParams({ days: String(days) })
  try {
    const [ovRes, bizRes, arRes, opsRes, activityRes, heatmapRes, funnelRes, originsRes, quotaRes] =
      await Promise.all([
        apiFetch(buildApiUrl('/metrics/overview', params)),
        apiFetch(buildApiUrl('/metrics/business', params)),
        apiFetch(buildApiUrl('/metrics/archive')),
        // Provedores: falha ou API antiga não derruba a página (cai em "indisponível").
        apiFetch(buildApiUrl('/metrics/ops', params)).catch(() => null),
        apiFetch(buildApiUrl('/metrics/competition-activity', params)).catch(() => null),
        apiFetch(buildApiUrl('/metrics/heatmap', params)).catch(() => null),
        apiFetch(buildApiUrl('/metrics/invite-funnel', params)).catch(() => null),
        apiFetch(buildApiUrl('/metrics/signup-origins', params)).catch(() => null),
        // Última medição das cotas, independente do período.
        apiFetch(buildApiUrl('/metrics/quota')).catch(() => null),
      ])
    if (ovRes.status === 403) return { kind: 'forbidden' }
    if (!ovRes.ok) return { kind: 'failed' }
    return {
      kind: 'ok',
      data: {
        overview: (await ovRes.json()) as OverviewResponse,
        // Negócio e arquivo são secundários — falha neles não derruba a página inteira.
        business: bizRes.ok ? ((await bizRes.json()) as BusinessResponse) : null,
        archive: arRes.ok ? ((await arRes.json()) as ArchiveResponse) : null,
        ops: await optionalJson<OpsResponse>(opsRes),
        activity: await optionalJson<CompetitionActivityResponse>(activityRes),
        heatmap: await optionalJson<HeatmapResponse>(heatmapRes),
        inviteFunnel: await optionalJson<InviteFunnelResponse>(funnelRes),
        signupOrigins: await optionalJson<SignupOriginsResponse>(originsRes),
        quota: await optionalJson<QuotaUsageResponse>(quotaRes),
      },
    }
  } catch {
    return { kind: 'failed' }
  }
}

export default function AdminMetricsPage() {
  useDocumentTitle('Métricas')

  const [days, setDays] = useState<number>(30)
  const { data, error, loading, retry } = useAdminLoad(days, loadMetrics)
  const {
    overview,
    business,
    archive,
    ops,
    activity,
    heatmap,
    inviteFunnel,
    signupOrigins,
    quota,
  } = data ?? NO_METRICS

  // Análise do arquivo frio, sob demanda (um mês por vez) — independente do período.
  // Só o último mês pedido grava resultado e encerra o "Lendo arquivos…".
  const [queryMonth, setQueryMonth] = useState<string | null>(null)
  const [queryResult, setQueryResult] = useState<ArchiveQueryResponse | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const latestQuery = useRef(0)
  useEffect(() => {
    const queries = latestQuery
    return () => {
      // Desmontou: nenhum pedido em voo é o último.
      queries.current += 1
    }
  }, [])

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
  } = useMetricsData(overview, archive, ops, business)

  const competitionNames: CompetitionNames = useMemo(
    () =>
      new Map(
        (business?.competitions ?? []).map((c) => [c.id, { name: c.name, season: c.season }]),
      ),
    [business],
  )

  async function runArchiveQuery(month: string) {
    const query = ++latestQuery.current
    setQueryMonth(month)
    setQueryLoading(true)
    setQueryResult(null)
    const result = await loadArchiveQuery(month)
    if (query !== latestQuery.current) return
    setQueryResult(result)
    setQueryLoading(false)
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
          <AdminLoadError
            message="Falha ao carregar as métricas."
            retryEventName="click_admin_metrics_tentar_novamente"
            onRetry={retry}
          />
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

            <QuotaUsageSection data={quota} />

            {business && <BusinessSection business={business} />}

            <InviteFunnelSection data={inviteFunnel} />

            <SignupOriginsSection data={signupOrigins} />

            <CompetitionActivitySection data={activity} />

            <EventsSection overview={overview} stacked={stacked} />
            <EngagementSection dauSeries={dauSeries} />
            <HeatmapSection data={heatmap} />
            <HealthSection overview={overview} apiCallsSeries={apiCallsSeries} />
            <ProviderOpsSection ops={ops} names={competitionNames} />
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
