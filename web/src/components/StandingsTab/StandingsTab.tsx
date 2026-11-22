import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import {
  competitionMatchesQueryOptions,
  matchesQueryErrorMessage,
} from '../../lib/competitionMatches'
import {
  type CompetitionType,
  type TeamStanding,
  computeStandings,
  isGeneralRanking,
  isLeagueTable,
  isStandingsTabEligible,
} from '../../lib/standings'
import ErrorState from '../ErrorState'
import { type Match } from '../MatchCard'
import Modal from '../Modal'
import styles from './StandingsTab.module.css'

export {
  type CompetitionType,
  type FormEntry,
  type TeamStanding,
  FORM_SIZE,
  GENERAL_RANKING,
  LEAGUE,
  computeStandings,
  isGeneralRanking,
  isLeagueTable,
  isStandingsTabEligible,
  standingsBucket,
} from '../../lib/standings'

const FORM_CLASS: Record<'v' | 'e' | 'd', string> = {
  v: styles.formWin,
  e: styles.formDraw,
  d: styles.formLoss,
}

const FORM_GLYPHS: Record<'v' | 'e' | 'd', string> = {
  v: '✓',
  e: '–',
  d: '✕',
}

interface StandingsTabProps {
  competitionId: string
  competitionType?: CompetitionType | null
  competitionCode?: string | null
}


function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function GroupMatchesModal({
  selectedGroup,
  matches,
  onClose,
}: {
  selectedGroup: string | null
  matches: Match[]
  onClose: () => void
}) {
  const selectedMatches =
    selectedGroup === null
      ? []
      : matches
          .filter((m) => m.group_name === selectedGroup)
          .sort((a, b) => (a.start_time < b.start_time ? -1 : 1))

  return (
    <Modal
      isOpen={selectedGroup !== null}
      onClose={onClose}
      title={`Grupo ${selectedGroup}`}
      analyticsId="jogos_grupo"
    >
      <ul className={styles.matchList}>
        {selectedMatches.map((m) => (
          <li key={m.id} className={styles.matchItem}>
            <span className={styles.matchTeams}>
              {m.status === 'scheduled' ? (
                <>
                  {m.home_team_short_name} vs {m.away_team_short_name}
                </>
              ) : (
                <>
                  {m.home_team_short_name} {m.home_score ?? '–'} × {m.away_score ?? '–'}{' '}
                  {m.away_team_short_name}
                </>
              )}
            </span>
            <span className={styles.matchInfo}>{formatDay(m.start_time)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function StandingsTable({ teams }: { teams: TeamStanding[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colPos}>#</th>
            <th className={styles.colCrest} aria-hidden="true"></th>
            <th className={styles.colTeam}>Time</th>
            <th className={styles.num} title="Pontos">
              P
            </th>
            <th className={styles.num} title="Jogos">
              J
            </th>
            <th className={styles.num} title="Vitórias">
              V
            </th>
            <th className={styles.num} title="Empates">
              E
            </th>
            <th className={styles.num} title="Derrotas">
              D
            </th>
            <th className={styles.num} title="Gols pró">
              GP
            </th>
            <th className={styles.num} title="Gols contra">
              GC
            </th>
            <th className={styles.num} title="Saldo de gols">
              SG
            </th>
            <th className={styles.colForm} title="Resultados dos últimos 4 jogos">
              Últimas 4
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t, i) => (
            <tr key={t.team_id}>
              <td className={styles.colPos}>{i + 1}</td>
              <td className={styles.colCrest}>
                <img
                  className={styles.crest}
                  src={t.team_logo}
                  alt={t.team_short_name}
                  loading="lazy"
                />
              </td>
              <td className={styles.colTeam}>{t.team_name}</td>
              <td className={styles.points}>{t.p}</td>
              <td>{t.j}</td>
              <td>{t.v}</td>
              <td>{t.e}</td>
              <td>{t.d}</td>
              <td>{t.gf}</td>
              <td>{t.ga}</td>
              <td>{t.sg}</td>
              <td className={styles.colForm}>
                <span className={styles.form}>
                  {t.form.map((f, fi) => (
                    <span
                      key={fi}
                      role="img"
                      aria-label={f.label}
                      title={f.label}
                      className={[
                        styles.formBadge,
                        FORM_CLASS[f.result],
                        fi === t.form.length - 1 ? styles.formLatest : '',
                      ].join(' ')}
                    >
                      <span aria-hidden="true">{FORM_GLYPHS[f.result]}</span>
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupTitle({ group, onSelect }: { group: string; onSelect: (group: string) => void }) {
  if (isLeagueTable(group)) {
    return (
      <div className={`${styles.groupHeader} ${styles.groupHeaderStatic}`}>
        <span>Classificação</span>
      </div>
    )
  }
  if (isGeneralRanking(group)) {
    return (
      <div className={`${styles.groupHeader} ${styles.groupHeaderStatic}`}>
        <span>Ranking geral</span>
      </div>
    )
  }
  return (
    <button
      className={styles.groupHeader}
      onClick={() => {
        trackEvent('click_standings_ver_grupo', { group })
        onSelect(group)
      }}
    >
      <span>Grupo {group}</span>
      <span className={styles.groupHint}>ver jogos</span>
    </button>
  )
}

export default function StandingsTab({
  competitionId,
  competitionType,
  competitionCode,
}: StandingsTabProps) {
  const matchesQuery = useQuery(competitionMatchesQueryOptions(competitionId))
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  if (matchesQuery.isPending) {
    return <p className={styles.loading}>Carregando classificação...</p>
  }

  if (matchesQuery.isError) {
    return (
      <ErrorState
        message={matchesQueryErrorMessage(matchesQuery.error, true) ?? 'Erro ao carregar jogos'}
      />
    )
  }

  const matches = matchesQuery.data.matches
  const standings = computeStandings(matches, competitionCode)

  if (standings.size === 0) {
    return (
      <p className={styles.empty}>
        {isStandingsTabEligible(competitionType, competitionCode)
          ? 'Ainda não há jogos das fases de classificação para montar a tabela.'
          : 'Esta competição não tem fase de grupos.'}
      </p>
    )
  }

  const groups = [...standings.keys()].sort((a, b) => {
    const rank = (g: string) => (isLeagueTable(g) || isGeneralRanking(g) ? 0 : 1)
    return rank(a) - rank(b) || a.localeCompare(b)
  })

  return (
    <div className={styles.root}>
      {groups.map((group) => (
        <div key={group} className={styles.group}>
          <GroupTitle group={group} onSelect={setSelectedGroup} />
          {isGeneralRanking(group) ? (
            <p className={styles.incompleteNote} role="note">
              A ESPN não entrega grupos completos nesta fase. Este ranking junta
              todos os jogos e não é a classificação oficial dos grupos.
            </p>
          ) : null}
          <StandingsTable teams={standings.get(group)!} />
        </div>
      ))}

      <GroupMatchesModal
        selectedGroup={selectedGroup}
        matches={matches}
        onClose={() => setSelectedGroup(null)}
      />
    </div>
  )
}
