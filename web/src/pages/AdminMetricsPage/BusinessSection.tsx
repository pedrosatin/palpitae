import { useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import AdminPills from '../AdminPills'
import shared from '../admin-shared.module.css'
import styles from './AdminMetricsPage.module.css'
import { formatNumber } from './format'
import { KpiCard } from './KpiCard'
import type { BusinessResponse, CompetitionSnapshot } from './types'

export default function BusinessSection({ business }: { business: BusinessResponse }) {
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

      {business.competitions ? (
        <>
          <CompetitionsTable
            competitions={business.competitions}
            activeGroupDays={business.activeGroupDays ?? 14}
          />
          <ResultsHealthTable competitions={business.competitions} />
        </>
      ) : (
        <LegacyTopCompetitions topCompetitions={business.topCompetitions} />
      )}
    </section>
  )
}

const VISIBILITY_FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'public', label: 'Públicas' },
  { value: 'pilot', label: 'Piloto' },
]

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'ongoing', label: 'Em andamento' },
  { value: 'upcoming', label: 'Próximos' },
  { value: 'finished', label: 'Encerrados' },
]

const VISIBILITY_LABELS: Record<string, string> = { public: 'pública', pilot: 'piloto' }

const STATUS_LABELS: Record<string, string> = {
  ongoing: 'em andamento',
  upcoming: 'próximo',
  finished: 'encerrado',
}

function FilterPills({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.filterRow}>
      <span className={styles.filterLabel}>{label}</span>
      <AdminPills
        options={options}
        value={value}
        onChange={onChange}
        className={`${shared.periods} ${styles.filterPills}`}
        role="group"
        ariaLabel={label}
        ariaPressed
      />
    </div>
  )
}

function CompetitionsTable({
  competitions,
  activeGroupDays,
}: {
  competitions: CompetitionSnapshot[]
  activeGroupDays: number
}) {
  const [visibility, setVisibility] = useState('all')
  const [status, setStatus] = useState('all')

  const filtered = competitions.filter(
    (c) =>
      (visibility === 'all' || c.visibility === visibility) &&
      (status === 'all' || c.status === status),
  )
  const withoutGroups = filtered.filter((c) => c.groups_current === 0).length

  function changeFilter(filter: 'visibility' | 'status', value: string) {
    trackEvent('click_admin_metrics_filtro_campeonato', { filter, value })
    if (filter === 'visibility') setVisibility(value)
    else setStatus(value)
  }

  return (
    <>
      <h3 className={styles.subTitle}>Grupos por campeonato</h3>
      <FilterPills
        label="Visibilidade"
        options={VISIBILITY_FILTERS}
        value={visibility}
        onChange={(v) => changeFilter('visibility', v)}
      />
      <FilterPills
        label="Status"
        options={STATUS_FILTERS}
        value={status}
        onChange={(v) => changeFilter('status', v)}
      />
      <p className={styles.hint}>
        {filtered.length} de {competitions.length} temporada(s) · {withoutGroups} sem grupo · ativo
        = grupo com palpite nos últimos {activeGroupDays} dias
      </p>
      {filtered.length === 0 ? (
        <p className={styles.hint}>Nenhuma temporada com esses filtros.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table} aria-label="Grupos por campeonato">
            <thead>
              <tr>
                <th>campeonato</th>
                <th>temporada</th>
                <th>provider</th>
                <th>visibilidade</th>
                <th>status</th>
                <th className={styles.num}>grupos</th>
                <th className={styles.num}>membros</th>
                <th className={styles.num}>ativos {activeGroupDays}d</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td title={c.id}>{c.name}</td>
                  <td className={styles.nowrap} title={c.slug}>
                    {c.season ?? c.slug}
                  </td>
                  <td className={styles.nowrap}>{c.provider ?? '—'}</td>
                  <td className={c.visibility === 'pilot' ? styles.statusWarn : undefined}>
                    {VISIBILITY_LABELS[c.visibility] ?? c.visibility}
                  </td>
                  <td className={styles.nowrap}>{STATUS_LABELS[c.status] ?? c.status}</td>
                  <td
                    className={`${styles.num} ${c.groups_current === 0 ? styles.statusMuted : ''}`}
                  >
                    {formatNumber(c.groups_current)}
                  </td>
                  <td className={styles.num}>{formatNumber(c.members)}</td>
                  <td className={styles.num}>{formatNumber(c.active_groups_14d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Contagem de saúde de resultados; "—" quando a API ainda não manda o campo. */
function HealthCount({ value }: { value: number | undefined }) {
  if (value === undefined) return <>—</>
  return <span className={value > 0 ? styles.statusWarn : styles.statusMuted}>{value}</span>
}

/**
 * Buraco de feed (jogo sem placar após kickoff + 3h) versus backlog de
 * pontuação (finished sem scored_at), por temporada. Quem tem pendência vem
 * primeiro; zeros continuam visíveis.
 */
function ResultsHealthTable({ competitions }: { competitions: CompetitionSnapshot[] }) {
  if (competitions.length === 0) return null

  const hasHealth = competitions.some(
    (c) => c.overdue_no_score !== undefined || c.finished_unscored !== undefined,
  )
  if (!hasHealth) {
    return (
      <>
        <h3 className={styles.subTitle}>Saúde dos resultados por campeonato</h3>
        <p className={styles.hint}>Indisponível: a API ainda não envia esses números.</p>
      </>
    )
  }

  const pending = (c: CompetitionSnapshot) => (c.overdue_no_score ?? 0) + (c.finished_unscored ?? 0)
  const sorted = [...competitions].sort((a, b) => pending(b) - pending(a))
  const withOverdue = competitions.filter((c) => (c.overdue_no_score ?? 0) > 0).length
  const withUnscored = competitions.filter((c) => (c.finished_unscored ?? 0) > 0).length

  return (
    <>
      <h3 className={styles.subTitle}>Saúde dos resultados por campeonato</h3>
      <p className={styles.hint}>
        {withOverdue} temporada(s) com jogo atrasado · {withUnscored} com jogo encerrado sem
        pontuação · atrasado = agendado ou ao vivo, sem placar completo, 3h após o início (adiados
        ficam de fora)
      </p>
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="Saúde dos resultados por campeonato">
          <thead>
            <tr>
              <th>campeonato</th>
              <th>temporada</th>
              <th>status</th>
              <th className={styles.num}>atrasados sem placar</th>
              <th className={styles.num}>encerrados sem pontuação</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id}>
                <td title={c.id}>{c.name}</td>
                <td className={styles.nowrap} title={c.slug}>
                  {c.season ?? c.slug}
                </td>
                <td className={styles.nowrap}>{STATUS_LABELS[c.status] ?? c.status}</td>
                <td className={styles.num}>
                  <HealthCount value={c.overdue_no_score} />
                </td>
                <td className={styles.num}>
                  <HealthCount value={c.finished_unscored} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Top 10 de uma API anterior ao snapshot por campeonato. */
function LegacyTopCompetitions({
  topCompetitions,
}: {
  topCompetitions: BusinessResponse['topCompetitions']
}) {
  return (
    <>
      <h3 className={styles.subTitle}>Campeonatos com mais grupos ativos</h3>
      {topCompetitions.length === 0 ? (
        <p className={styles.hint}>Nenhum grupo ativo.</p>
      ) : (
        <div>
          {topCompetitions.map((c, index) => {
            const max = topCompetitions[0].groups
            const pct = max > 0 ? Math.round((c.groups / max) * 100) : 0
            return (
              <div key={`${c.competition}-${index}`} className={styles.miniBarRow}>
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
    </>
  )
}
