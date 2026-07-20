import { useEffect, useMemo, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { buildApiUrl } from '../../config'
import { apiFetch } from '../../lib/api'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import ErrorState from '../../components/ErrorState'
import styles from './AdminMetricsPage.module.css'
import { BarChart, OTHER_COLOR, SERIES_COLORS, StackedBarChart } from './charts'
import { eventLabel } from './labels'

/**
 * Dashboard admin de métricas server-side (Analytics Engine + R2).
 *
 * Consome GET /metrics/overview e /metrics/archive — a API é quem fala com a
 * SQL API do Analytics Engine (token de conta nunca chega ao cliente). Acesso
 * restrito ao ADMIN_EMAIL; para qualquer outro usuário a API responde 403 e a
 * página mostra "acesso restrito". Não há link de navegação — URL direta.
 */

interface OverviewResponse {
  days: number
  totals: { event_type: string; count: string | number }[]
  daily: { day: string; event_type: string; count: string | number }[]
  poller: {
    status: string
    runs: string | number
    avg_duration_ms: string | number
    max_duration_ms: string | number
  }[]
  predictions: { active_users: string | number; total: string | number }
  cache: { result: string; count: string | number }[]
  loginFailures: { reason: string; count: string | number }[]
  apiCallsDaily: { day: string; api_calls: string | number }[]
  recentErrors: {
    timestamp: string
    event_type: string
    blob2: string
    blob3: string
    blob4: string
  }[]
  sampling: { avg_sample_interval: string | number }
  whales: { user_hash: string; predictions: string | number }[]
  lastRuns: { event_type: string; last_run: string }[]
  emailHealth: {
    rounds: string | number
    sent: string | number
    failed: string | number
  }
}

interface ArchiveResponse {
  // `events` = contagem real do dia (customMetadata do export); null em
  // arquivo antigo que o backfill de metadata ainda não alcançou.
  files: {
    key: string
    size: number
    uploaded: string
    events: number | null
  }[]
}

const PERIODS = [7, 30, 90] as const

// Acima disso os tipos menos frequentes agrupam em "outros" (paleta acaba).
const MAX_CHART_TYPES = SERIES_COLORS.length

/** Últimos `days` dias UTC, do mais antigo pro mais novo (YYYY-MM-DD). */
function lastDays(days: number, endOffset = 0): string[] {
  const today = new Date()
  const keys: string[] = []
  for (let back = days - 1 + endOffset; back >= endOffset; back--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back),
    )
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

/**
 * Monta as barras empilhadas: um segmento por tipo de evento por dia, tipos
 * ordenados por volume total, excedentes da paleta agrupados em "outros".
 * Dias sem evento entram zerados (buraco visível = dia sem tráfego).
 */
function buildStackedSeries(
  daily: OverviewResponse['daily'],
  totals: OverviewResponse['totals'],
  days: number,
) {
  const ranked = totals.map((t) => t.event_type)
  const top = ranked.slice(0, MAX_CHART_TYPES)
  const colorFor = new Map(top.map((type, i) => [type, SERIES_COLORS[i]]))
  const hasOthers = ranked.length > top.length

  const byDay = new Map<string, Map<string, number>>()
  for (const row of daily) {
    const day = row.day.slice(0, 10) // "YYYY-MM-DD hh:mm:ss" → "YYYY-MM-DD"
    const type = colorFor.has(row.event_type) ? row.event_type : 'outros'
    const perType = byDay.get(day) ?? new Map<string, number>()
    perType.set(type, (perType.get(type) ?? 0) + Number(row.count))
    byDay.set(day, perType)
  }

  const order = hasOthers ? [...top, 'outros'] : top
  const series = lastDays(days).map((label) => {
    const perType = byDay.get(label)
    return {
      label,
      segments: order
        .map((type) => ({
          type,
          value: perType?.get(type) ?? 0,
          color: colorFor.get(type) ?? OTHER_COLOR,
        }))
        .filter((s) => s.value > 0),
    }
  })

  const legend = order.map((type) => ({
    type,
    color: colorFor.get(type) ?? OTHER_COLOR,
  }))
  return { series, legend }
}

function buildApiCallsSeries(
  apiCallsDaily: OverviewResponse['apiCallsDaily'],
  days: number,
): { label: string; total: number }[] {
  const byDay = new Map(apiCallsDaily.map((r) => [r.day.slice(0, 10), Number(r.api_calls)]))
  return lastDays(days).map((label) => ({
    label,
    total: byDay.get(label) ?? 0,
  }))
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
const CRON_INFO: Record<string, { label: string; staleAfterMin: number }> = {
  poller_run: {
    label: 'Poller de resultados (a cada 30 min)',
    staleAfterMin: 45,
  },
  fixture_discovery_run: {
    label: 'Descoberta de jogos (diário)',
    staleAfterMin: 26 * 60,
  },
  cron_round_reminder: {
    label: 'Lembrete de rodada (diário)',
    staleAfterMin: 26 * 60,
  },
}

function isStale(ts: string, staleAfterMin: number): boolean {
  const date = new Date(`${ts.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return false
  return Date.now() - date.getTime() > staleAfterMin * 60_000
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
      {hint && <span className={styles.kpiHint}>{hint}</span>}
    </div>
  )
}

function useMetricsData(overview: OverviewResponse | null, archive: ArchiveResponse | null) {
  const stacked = useMemo(
    () =>
      overview
        ? buildStackedSeries(overview.daily, overview.totals, overview.days)
        : { series: [], legend: [] },
    [overview],
  )

  const apiCallsSeries = useMemo(
    () => (overview ? buildApiCallsSeries(overview.apiCallsDaily, overview.days) : []),
    [overview],
  )

  const kpis = useMemo(() => {
    if (!overview) return null
    const totalOf = (type: string) =>
      Number(overview.totals.find((t) => t.event_type === type)?.count ?? 0)
    const hits = Number(overview.cache.find((c) => c.result === 'hit')?.count ?? 0)
    const misses = Number(overview.cache.find((c) => c.result === 'miss')?.count ?? 0)
    const cacheTotal = hits + misses
    const groupsCreated = totalOf('group_created')
    const groupsJoined = totalOf('group_joined')
    return {
      activeUsers: Number(overview.predictions.active_users ?? 0),
      predictions: Number(overview.predictions.total ?? 0),
      groupsCreated,
      // Conversão de convite: entradas por grupo criado no período.
      joinRate: groupsCreated > 0 ? (groupsJoined / groupsCreated).toFixed(1) : '—',
      logins: totalOf('login_success'),
      cacheHitRate: cacheTotal > 0 ? `${Math.round((hits / cacheTotal) * 100)}%` : '—',
      emailUnsubs: totalOf('email_unsubscribed'),
      emailResubs: totalOf('email_resubscribed'),
    }
  }, [overview])

  // Sampling do AE: média > 1 significa amostragem — números viram estimativa.
  const avgSample = overview ? Number(overview.sampling.avg_sample_interval ?? 1) : 1
  const isSampling = avgSample > 1.01

  // Concentração de palpites: fatia do total dos N maiores palpiteiros (whales).
  const whaleShare = useMemo(() => {
    if (!overview || !kpis || kpis.predictions === 0 || overview.whales.length === 0) return null
    const shareOf = (n: number) =>
      Math.min(
        100,
        Math.round(
          (overview.whales.slice(0, n).reduce((sum, w) => sum + Number(w.predictions), 0) /
            kpis.predictions) *
            100,
        ),
      )
    return { top1: shareOf(1), top5: shareOf(5) }
  }, [overview, kpis])

  // Integridade do cold path: últimos 14 dias já exportáveis (até ontem — o
  // export roda 00:05 UTC do dia seguinte). "faltando" = export falhou; dias
  // anteriores ao primeiro arquivo mostram "—" (o export ainda não existia).
  const archiveDays = useMemo(() => {
    if (!archive || archive.files.length === 0) return []
    const byDay = new Map(
      archive.files.map((f) => [f.key.replace('events/', '').replace('.ndjson', ''), f]),
    )
    const oldest = [...byDay.keys()].sort()[0].replaceAll('/', '-')
    return lastDays(14, 1)
      .reverse()
      .map((day) => {
        const key = day.replaceAll('-', '/')
        const file = byDay.get(key) ?? null
        return { day, file, beforeFirstExport: !file && day < oldest }
      })
  }, [archive])

  // Acervo completo do R2: estatísticas + eventos/mês. É a única visão que
  // enxerga além da janela de ~3 meses do Analytics Engine.
  const archiveStats = useMemo(() => {
    if (!archive || archive.files.length === 0) return null
    const totalBytes = archive.files.reduce((sum, f) => sum + f.size, 0)
    const totalEvents = archive.files.reduce((sum, f) => sum + (f.events ?? 0), 0)
    const missingMeta = archive.files.filter((f) => f.events === null).length
    const oldestDay = archive.files
      .map((f) => f.key.replace('events/', '').replace('.ndjson', '').replaceAll('/', '-'))
      .sort()[0]

    const byMonth = new Map<string, number>()
    for (const f of archive.files) {
      const month = f.key.replace('events/', '').slice(0, 7).replace('/', '-') // YYYY-MM
      byMonth.set(month, (byMonth.get(month) ?? 0) + (f.events ?? 0))
    }
    const monthly = [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, total]) => ({ label, total }))

    return {
      totalDays: archive.files.length,
      totalBytes,
      totalEvents,
      missingMeta,
      oldestDay,
      monthly,
    }
  }, [archive])

  return {
    stacked,
    apiCallsSeries,
    kpis,
    avgSample,
    isSampling,
    whaleShare,
    archiveDays,
    archiveStats,
  }
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
      <KpiCard label="usuários palpitando" value={String(kpis.activeUsers)} />
      <KpiCard label="palpites salvos" value={String(kpis.predictions)} />
      <KpiCard label="grupos criados" value={String(kpis.groupsCreated)} />
      <KpiCard label="entradas por grupo" value={kpis.joinRate} hint="conversão de convite" />
      <KpiCard label="logins" value={String(kpis.logins)} />
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
                  <td className={styles.num}>{Number(t.count)}</td>
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
                <td className={styles.num}>{Number(p.runs)}</td>
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
            <td className={styles.num}>{Number(overview.emailHealth.rounds)}</td>
          </tr>
          <tr>
            <td>e-mails enviados</td>
            <td className={styles.num}>{Number(overview.emailHealth.sent)}</td>
          </tr>
          <tr>
            <td>falhas de envio</td>
            <td
              className={`${styles.num} ${Number(overview.emailHealth.failed) > 0 ? styles.statusError : ''}`}
            >
              {Number(overview.emailHealth.failed)}
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
                <td className={styles.num}>{Number(f.count)}</td>
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
            <KpiCard label="dias arquivados" value={String(archiveStats.totalDays)} />
            <KpiCard
              label="eventos arquivados"
              value={`${archiveStats.missingMeta > 0 ? '≥ ' : ''}${archiveStats.totalEvents}`}
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

export default function AdminMetricsPage() {
  useDocumentTitle('Métricas')

  const [days, setDays] = useState<number>(30)
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [archive, setArchive] = useState<ArchiveResponse | null>(null)
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ days: String(days) })
    Promise.all([
      apiFetch(buildApiUrl('/metrics/overview', params)),
      apiFetch(buildApiUrl('/metrics/archive')),
    ])
      .then(async ([ovRes, arRes]) => {
        if (cancelled) return
        if (ovRes.status === 403) {
          setError('forbidden')
          return
        }
        if (!ovRes.ok) throw new Error(`overview ${ovRes.status}`)
        setOverview((await ovRes.json()) as OverviewResponse)
        // Arquivo é secundário — falha nele não derruba a página inteira.
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
    kpis,
    avgSample,
    isSampling,
    whaleShare,
    archiveDays,
    archiveStats,
  } = useMetricsData(overview, archive)

  if (error === 'forbidden') {
    return (
      <div className={styles.root}>
        <div className={styles.content}>
          <ErrorState message="Acesso restrito ao administrador." />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Métricas</h1>
          <div className={styles.periods}>
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                className={p === days ? styles.periodActive : styles.period}
                onClick={() => {
                  trackEvent('click_admin_metrics_periodo', { days: p })
                  setDays(p)
                }}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>

        {error === 'failed' && (
          <ErrorState message="Falha ao carregar as métricas. Tente de novo." />
        )}

        {loading && <p className={styles.hint}>Carregando…</p>}

        {overview && kpis && !loading && (
          <>
            <OverviewKpisRow kpis={kpis} />

            {isSampling && (
              <p className={styles.samplingWarning}>
                ⚠️ Analytics Engine está amostrando (média de _sample_interval ={' '}
                {avgSample.toFixed(2)}) — os números do período são estimativa e o volume de eventos
                merece atenção.
              </p>
            )}

            <EventsSection overview={overview} stacked={stacked} />
            <HealthSection overview={overview} apiCallsSeries={apiCallsSeries} />
            <EmailSection overview={overview} kpis={kpis} />
            <ConcentrationSection whaleShare={whaleShare} />
            <LoginFailuresSection overview={overview} />
            <RecentErrorsSection overview={overview} />
          </>
        )}

        {archive && !loading && (
          <ArchiveSection archiveStats={archiveStats} archiveDays={archiveDays} />
        )}
      </div>
    </div>
  )
}
