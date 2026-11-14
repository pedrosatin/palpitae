import { useMemo, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { buildApiUrl } from '../../config'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { apiFetch } from '../../lib/api'
import { DAY_MS, formatNumber, parseSqlUtc } from '../AdminMetricsPage/format'
import AdminPageShell, { AdminLoadError } from '../AdminPageShell'
import AdminPills from '../AdminPills'
import { useAdminLoad, type AdminLoad } from '../useAdminLoad'
import styles from './AdminRadarPage.module.css'
import { Sparkline } from './Sparkline'

/**
 * Radar de competições (admin) — responde "qual campeonato vale a pena
 * incorporar ao Palpitae?" cruzando oferta (o que está em andamento agora),
 * interesse do público brasileiro (pageviews da pt.wikipedia) e demanda interna
 * (grupos já criados).
 *
 * Consome GET /metrics/radar, que lê o snapshot diário do D1 gravado pelo cron
 * `radar/sync.ts`. Mesmo gate do dashboard de métricas: só o ADMIN_EMAIL, sem
 * link de navegação — URL direta.
 */

interface RadarItem {
  id: string
  name: string
  country: string | null
  type: string | null
  logoUrl: string | null
  season: string
  startsOn: string | null
  endsOn: string | null
  status: 'upcoming' | 'ongoing' | 'finished'
  wikiArticle: string | null
  matchesInPeriod: number
  matchesToday: number
  pageviewsAvg: number | null
  pageviewsTrend: number | null
  pageviewsSeries: { day: string; views: number | null }[]
  supported: boolean
  internalGroups: number
}

interface RadarResponse {
  days: number
  lastSync: string | null
  items: RadarItem[]
}

const STATUS_LABEL: Record<RadarItem['status'], string> = {
  ongoing: 'Em andamento',
  upcoming: 'A começar',
  finished: 'Encerrada',
}

/**
 * Recorte de status. "A começar" é uma pergunta de produto diferente de "está
 * rolando": dá o tempo de preparação para entrar numa competição antes da bola
 * rolar, que é quando o grupo se forma.
 */
const STATUS_FILTERS = [
  { key: 'ongoing', label: 'Em andamento' },
  { key: 'upcoming', label: 'A começar' },
  { key: 'all', label: 'Todas' },
] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]['key']

const STATUS_OPTIONS = STATUS_FILTERS.map((f) => ({ value: f.key, label: f.label }))

/** Snapshot mais velho que isso = cron do radar provavelmente parado. */
const STALE_AFTER_HOURS = 30

/** "YYYY-MM-DD" → "dd/mm/aaaa"; null vira travessão. */
function formatDay(day: string | null): string {
  if (!day) return '—'
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

function formatTrend(trend: number | null): string {
  if (trend === null) return '—'
  return `${trend > 0 ? '+' : ''}${trend}%`
}

function trendClass(trend: number | null): string {
  if (trend !== null && trend > 0) return styles.trendUp
  if (trend !== null && trend < 0) return styles.trendDown
  return styles.muted
}

/**
 * "estreia em X dias" — a janela de preparação para entrar na competição antes
 * da bola rolar. Null quando a data não é futura ou não é conhecida.
 */
function countdown(startsOn: string | null): string | null {
  if (!startsOn) return null
  const target = new Date(`${startsOn}T00:00:00Z`).getTime()
  if (Number.isNaN(target)) return null
  const days = Math.ceil((target - Date.now()) / DAY_MS)
  if (days <= 0) return null
  if (days === 1) return 'estreia amanhã'
  if (days < 60) return `estreia em ${days} dias`
  return `estreia em ${Math.round(days / 30)} meses`
}

/**
 * Veredito por competição — a leitura que a tela existe pra dar. Deliberadamente
 * grosseiro: é gatilho de investigação, não decisão automática.
 */
function verdict(item: RadarItem, medianInterest: number): { label: string; level: string } | null {
  if (item.supported) return null
  if (item.status === 'finished') return null
  if (item.pageviewsAvg === null) return null
  if (item.pageviewsAvg >= medianInterest * 2) {
    return { label: 'Candidata forte', level: styles.verdictStrong }
  }
  if (item.pageviewsAvg >= medianInterest) {
    return { label: 'Vale investigar', level: styles.verdictMaybe }
  }
  return null
}

type SortKey = 'interest' | 'matches' | 'name' | 'start'

// Mediana do interesse entre as competições com sinal — régua do veredito.
// Mediana e não média: umas poucas competições gigantes (Copa do Mundo)
// puxariam a média e esconderiam todo o resto.
function medianInterestOf(items: RadarItem[]): number {
  const values = items
    .map((i) => i.pageviewsAvg)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)
  if (values.length === 0) return 0
  const mid = Math.floor(values.length / 2)
  // Amostra par: média dos dois centrais. Pegar só o de cima inflaria a régua
  // justamente quando há poucas competições medidas.
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid]
}

const NO_ITEMS: RadarItem[] = []

type RadarFilter = { statusFilter: StatusFilter; onlyUnsupported: boolean; search: string }

function matchesFilter(item: RadarItem, filter: RadarFilter, term: string): boolean {
  if (filter.statusFilter !== 'all' && item.status !== filter.statusFilter) return false
  if (filter.onlyUnsupported && item.supported) return false
  if (term && !`${item.name} ${item.country ?? ''}`.toLowerCase().includes(term)) return false
  return true
}

function compareBy(sort: SortKey, a: RadarItem, b: RadarItem): number {
  if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR')
  if (sort === 'matches') return b.matchesInPeriod - a.matchesInPeriod
  // Estreia mais próxima primeiro; sem data conhecida vai pro fim.
  if (sort === 'start') return (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999')
  return (b.pageviewsAvg ?? -1) - (a.pageviewsAvg ?? -1)
}

function visibleItems(items: RadarItem[], filter: RadarFilter, sort: SortKey): RadarItem[] {
  const term = filter.search.trim().toLowerCase()
  return items
    .filter((item) => matchesFilter(item, filter, term))
    .sort((a, b) => compareBy(sort, a, b))
}

function isSyncStale(lastSync: string | null | undefined): boolean {
  if (!lastSync) return false
  const at = parseSqlUtc(lastSync)
  if (Number.isNaN(at)) return false
  return Date.now() - at > STALE_AFTER_HOURS * 3_600_000
}

/** GET /metrics/radar do período. Não lança: rede, status ou corpo inválido viram `failed`. */
async function loadRadar(days: number): Promise<AdminLoad<RadarResponse>> {
  try {
    const res = await apiFetch(
      buildApiUrl('/metrics/radar', new URLSearchParams({ days: String(days) })),
    )
    if (res.status === 403) return { kind: 'forbidden' }
    if (!res.ok) return { kind: 'failed' }
    return { kind: 'ok', data: (await res.json()) as RadarResponse }
  } catch {
    return { kind: 'failed' }
  }
}

export default function AdminRadarPage() {
  useDocumentTitle('Radar de competições')

  const [days, setDays] = useState<number>(30)
  const { data, error, loading, retry } = useAdminLoad(days, loadRadar)
  const [sort, setSort] = useState<SortKey>('interest')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ongoing')
  const [onlyUnsupported, setOnlyUnsupported] = useState(false)
  const [search, setSearch] = useState('')

  const items = data?.items ?? NO_ITEMS
  const medianInterest = useMemo(() => medianInterestOf(items), [items])
  const visible = useMemo(
    () => visibleItems(items, { statusFilter, onlyUnsupported, search }, sort),
    [items, statusFilter, onlyUnsupported, search, sort],
  )

  // Sem artigo mapeado = sem sinal de interesse. É a fila de curadoria de
  // `api/src/radar/articles.ts`, por isso fica visível em vez de escondida.
  // Inclui as que vão começar: competição não mapeada prestes a estrear é ainda
  // mais urgente de medir do que uma já em curso.
  const unmapped = useMemo(
    () => items.filter((i) => !i.wikiArticle && i.status !== 'finished'),
    [items],
  )

  const staleSync = useMemo(() => isSyncStale(data?.lastSync), [data])

  return (
    <AdminPageShell
      title="Radar de competições"
      days={days}
      onDaysChange={setDays}
      periodEventName="click_admin_radar_periodo"
      forbidden={error === 'forbidden'}
      contentClassName={styles.content}
    >
      <>
        <p className={styles.hint}>
          Interesse = média de acessos diários ao artigo da competição na Wikipédia em português
          (proxy de audiência brasileira). Demanda = grupos ativos no Palpitae.
        </p>

        {error === 'failed' && (
          <AdminLoadError
            message="Falha ao carregar o radar."
            retryEventName="click_admin_radar_tentar_novamente"
            onRetry={retry}
          />
        )}

        {staleSync && (
          <p className={styles.staleWarning}>
            ⚠️ Último snapshot em {data?.lastSync} (UTC) — o cron do radar pode estar parado.
          </p>
        )}

        {loading && <p className={styles.hint}>Carregando…</p>}

        {data && !loading && (
          <>
            <section className={styles.section}>
              <RadarFilters
                search={search}
                setSearch={setSearch}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                onlyUnsupported={onlyUnsupported}
                setOnlyUnsupported={setOnlyUnsupported}
                setSort={setSort}
              />
              <RadarTable
                visible={visible}
                sort={sort}
                setSort={setSort}
                medianInterest={medianInterest}
              />
            </section>

            {unmapped.length > 0 && <UnmappedList unmapped={unmapped} />}
          </>
        )}
      </>
    </AdminPageShell>
  )
}

function SortButton({
  current,
  value,
  onSort,
  children,
}: {
  current: SortKey
  value: SortKey
  onSort: (key: SortKey) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={current === value ? styles.sortActive : styles.sort}
      onClick={() => {
        trackEvent('click_admin_radar_ordenar', { sort: value })
        onSort(value)
      }}
    >
      {children}
      {current === value && ' ↓'}
    </button>
  )
}

function RadarFilters({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  onlyUnsupported,
  setOnlyUnsupported,
  setSort,
}: {
  search: string
  setSearch: (value: string) => void
  statusFilter: StatusFilter
  setStatusFilter: (value: StatusFilter) => void
  onlyUnsupported: boolean
  setOnlyUnsupported: (value: boolean) => void
  setSort: (value: SortKey) => void
}) {
  return (
    <div className={styles.filters}>
      <input
        className={styles.search}
        type="search"
        placeholder="Buscar competição ou país…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Buscar competição"
      />
      <AdminPills
        options={STATUS_OPTIONS}
        value={statusFilter}
        onChange={(key) => {
          trackEvent('click_admin_radar_filtrar_status', { status: key })
          setStatusFilter(key)
          setSort(key === 'upcoming' ? 'start' : 'interest')
        }}
        className={styles.statusFilters}
        role="group"
        ariaLabel="Filtrar por status"
        ariaPressed
      />
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={onlyUnsupported}
          onChange={(e) => {
            trackEvent('click_admin_radar_filtrar_nao_suportadas')
            setOnlyUnsupported(e.target.checked)
          }}
        />
        Só não suportadas
      </label>
    </div>
  )
}

function VerdictCell({ item, medianInterest }: { item: RadarItem; medianInterest: number }) {
  if (item.supported) {
    return (
      <td>
        <span className={styles.supported}>✓ no Palpitae</span>
      </td>
    )
  }
  const call = verdict(item, medianInterest)
  return (
    <td>
      {call ? (
        <span className={call.level}>{call.label}</span>
      ) : (
        <span className={styles.muted}>—</span>
      )}
    </td>
  )
}

function RadarTable({
  visible,
  sort,
  setSort,
  medianInterest,
}: {
  visible: RadarItem[]
  sort: SortKey
  setSort: (value: SortKey) => void
  medianInterest: number
}) {
  return (
    <>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>
              <SortButton current={sort} value="name" onSort={setSort}>
                Competição
              </SortButton>
            </th>
            <th>
              <SortButton current={sort} value="start" onSort={setSort}>
                Status
              </SortButton>
            </th>
            <th className={styles.num}>
              <SortButton current={sort} value="matches" onSort={setSort}>
                Jogos
              </SortButton>
            </th>
            <th className={styles.num}>
              <SortButton current={sort} value="interest" onSort={setSort}>
                Interesse BR
              </SortButton>
            </th>
            <th>Tendência</th>
            <th className={styles.num}>Grupos</th>
            <th>Veredito</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => {
            const startsIn = item.status === 'upcoming' ? countdown(item.startsOn) : null
            return (
              <tr key={item.id}>
                <td>
                  <span className={styles.compName}>{item.name}</span>
                  <span className={styles.compMeta}>
                    {item.country} · {item.season} · {formatDay(item.startsOn)} →{' '}
                    {formatDay(item.endsOn)}
                  </span>
                </td>
                <td>
                  <span className={styles[`status_${item.status}`]}>
                    {STATUS_LABEL[item.status]}
                  </span>
                  {startsIn && <span className={styles.countdown}>{startsIn}</span>}
                </td>
                <td className={styles.num}>
                  {formatNumber(item.matchesInPeriod)}
                  {item.matchesToday > 0 && (
                    <span className={styles.todayBadge}>{item.matchesToday} hoje</span>
                  )}
                </td>
                <td className={styles.num}>
                  {item.pageviewsAvg === null ? (
                    <span className={styles.muted}>sem artigo</span>
                  ) : (
                    <span className={styles.interestCell}>
                      {formatNumber(item.pageviewsAvg)}
                      <Sparkline series={item.pageviewsSeries} />
                    </span>
                  )}
                </td>
                <td className={trendClass(item.pageviewsTrend)}>
                  {formatTrend(item.pageviewsTrend)}
                </td>
                <td className={styles.num}>
                  {item.supported ? formatNumber(item.internalGroups) : '—'}
                </td>
                <VerdictCell item={item} medianInterest={medianInterest} />
              </tr>
            )
          })}
        </tbody>
      </table>

      {visible.length === 0 && (
        <p className={styles.hint}>Nenhuma competição com os filtros atuais.</p>
      )}
    </>
  )
}

function UnmappedList({ unmapped }: { unmapped: RadarItem[] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Sem sinal de interesse</h2>
      <p className={styles.hint}>
        Em andamento, mas sem artigo da Wikipédia mapeado — para medi-las, adicione uma entrada em{' '}
        <code>api/src/radar/articles.ts</code>.
      </p>
      <ul className={styles.unmappedList}>
        {unmapped.map((item) => (
          <li key={item.id}>
            {item.name} <span className={styles.muted}>({item.country})</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
