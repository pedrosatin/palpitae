import { useEffect, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { fetchCompetitionMatches } from '../../lib/competitionMatches'
import ErrorState from '../ErrorState'
import { type Match } from '../MatchCard'
import Modal from '../Modal'
import styles from './StandingsTab.module.css'

export type CompetitionType = 'league' | 'cup'

/** Chave do bucket único de liga em computeStandings ('' nunca colide com nome de grupo). */
export const LEAGUE = ''

export function isLeagueTable(group: string): boolean {
  return group === LEAGUE
}

/** Quantos jogos recentes a coluna "Últimas" mostra. */
export const FORM_SIZE = 4

const RESULT_LABELS: Record<'v' | 'e' | 'd', string> = {
  v: 'Vitória',
  e: 'Empate',
  d: 'Derrota',
}

const FORM_GLYPHS: Record<'v' | 'e' | 'd', string> = {
  v: '✓',
  e: '–',
  d: '✕',
}

interface StandingsTabProps {
  competitionId: string
  /** Gate vem do grupo (competitions.type); decide o texto do empty state. */
  competitionType?: CompetitionType | null
}

/** Resultado de um jogo na forma recente do time, mais antigo → mais recente. */
export interface FormEntry {
  result: 'v' | 'e' | 'd'
  /** Descrição acessível, ex.: "Vitória 2x1 contra FLA". */
  label: string
}

export interface TeamStanding {
  team_id: string
  team_name: string
  team_short_name: string
  team_logo: string
  /** Últimos 4 jogos (FORM_SIZE), mais recente por último. */
  form: FormEntry[]
  p: number
  j: number
  v: number
  e: number
  d: number
  gf: number
  ga: number
  sg: number
}

function emptyStanding(
  team_id: string,
  team_name: string,
  team_short_name: string,
  team_logo: string,
): TeamStanding {
  return {
    team_id,
    team_name,
    team_short_name,
    team_logo,
    form: [],
    p: 0,
    j: 0,
    v: 0,
    e: 0,
    d: 0,
    gf: 0,
    ga: 0,
    sg: 0,
  }
}

function applyMatchResult(home: TeamStanding, away: TeamStanding, m: Match) {
  if (m.status !== 'finished' || m.home_score === null || m.away_score === null) {
    return
  }

  home.j += 1
  away.j += 1
  home.gf += m.home_score
  home.ga += m.away_score
  away.gf += m.away_score
  away.ga += m.home_score
  home.sg = home.gf - home.ga
  away.sg = away.gf - away.ga

  if (m.home_score > m.away_score) {
    home.v += 1
    home.p += 3
    away.d += 1
  } else if (m.home_score < m.away_score) {
    away.v += 1
    away.p += 3
    home.d += 1
  } else {
    home.e += 1
    away.e += 1
    home.p += 1
    away.p += 1
  }

  const score = `${m.home_score}x${m.away_score}`
  const homeResult: FormEntry['result'] =
    m.home_score > m.away_score ? 'v' : m.home_score < m.away_score ? 'd' : 'e'
  const awayResult: FormEntry['result'] = homeResult === 'v' ? 'd' : homeResult === 'd' ? 'v' : 'e'

  home.form.push({
    result: homeResult,
    label: `${RESULT_LABELS[homeResult]} ${score} contra ${m.away_team_short_name}`,
  })
  away.form.push({
    result: awayResult,
    label: `${RESULT_LABELS[awayResult]} ${score} contra ${m.home_team_short_name}`,
  })
}

function sortStandings(
  byGroup: Map<string, Map<string, TeamStanding>>,
): Map<string, TeamStanding[]> {
  const result = new Map<string, TeamStanding[]>()
  for (const [group, teams] of byGroup) {
    for (const team of teams.values()) {
      team.form = team.form.slice(-FORM_SIZE)
    }
    // Liga (CBF, aproximado): pontos, VITÓRIAS, saldo, gols pró. Critérios
    // seguintes do regulamento (confronto direto, cartões) não se aplicam —
    // cartões não são sincronizados; empate residual cai em ordem alfabética.
    // Copa (FIFA): pontos, saldo, gols pró.
    const isLeague = isLeagueTable(group)
    const sorted = [...teams.values()].sort(
      (a, b) =>
        b.p - a.p ||
        (isLeague ? b.v - a.v : 0) ||
        b.sg - a.sg ||
        b.gf - a.gf ||
        a.team_name.localeCompare(b.team_name),
    )
    result.set(group, sorted)
  }
  return result
}

export function computeStandings(matches: Match[]): Map<string, TeamStanding[]> {
  const byGroup = new Map<string, Map<string, TeamStanding>>()

  function teamFor(
    group: string,
    id: string,
    name: string,
    shortName: string,
    logo: string,
  ): TeamStanding {
    let teams = byGroup.get(group)
    if (!teams) {
      teams = new Map()
      byGroup.set(group, teams)
    }
    let team = teams.get(id)
    if (!team) {
      team = emptyStanding(id, name, shortName, logo)
      teams.set(id, team)
    }
    return team
  }

  // LEAGUE ('') = tabela única de liga (pontos corridos). Copa: agrupa por
  // group_name (fase de grupos) e ignora mata-mata (group_name null fora de
  // REGULAR_SEASON).
  // Ordem cronológica: a coluna de forma depende de "mais recente por último";
  // a ordem do payload de /matches não é garantida.
  const chronological = [...matches].sort((a, b) =>
    a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
  )

  for (const m of chronological) {
    const groupKey = m.group_name ?? (m.phase === 'REGULAR_SEASON' ? LEAGUE : null)
    if (groupKey === null) continue

    // Ensure both teams appear in the table even before any match is played.
    const home = teamFor(
      groupKey,
      m.home_team_id,
      m.home_team_name,
      m.home_team_short_name,
      m.home_team_logo,
    )
    const away = teamFor(
      groupKey,
      m.away_team_id,
      m.away_team_name,
      m.away_team_short_name,
      m.away_team_logo,
    )

    applyMatchResult(home, away, m)
  }

  return sortStandings(byGroup)
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
    <Modal isOpen={selectedGroup !== null} onClose={onClose} title={`Grupo ${selectedGroup}`}>
      <ul className={styles.matchList}>
        {selectedMatches.map((m) => (
          <li key={m.id} className={styles.matchItem}>
            {m.status === 'scheduled' ? (
              <>
                <span className={styles.matchTeams}>
                  {m.home_team_short_name} vs {m.away_team_short_name}
                </span>
                <span className={styles.matchInfo}>{formatDay(m.start_time)}</span>
              </>
            ) : (
              <>
                <span className={styles.matchTeams}>
                  {m.home_team_short_name} {m.home_score ?? '–'} × {m.away_score ?? '–'}{' '}
                  {m.away_team_short_name}
                </span>
                <span className={styles.matchInfo}>{formatDay(m.start_time)}</span>
              </>
            )}
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
                        f.result === 'v'
                          ? styles.formWin
                          : f.result === 'd'
                            ? styles.formLoss
                            : styles.formDraw,
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

export default function StandingsTab({ competitionId, competitionType }: StandingsTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchCompetitionMatches(competitionId)
      .then((data) => setMatches(data.matches))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [competitionId])

  if (loading) {
    return <p className={styles.loading}>Carregando classificação...</p>
  }

  if (error) {
    return <ErrorState message={error} />
  }

  const standings = computeStandings(matches)

  if (standings.size === 0) {
    // Liga sem jogos sincronizados ainda não tem tabela — mas dizer "não tem
    // fase de grupos" seria falso; a mensagem certa depende do tipo.
    return (
      <p className={styles.empty}>
        {competitionType === 'league'
          ? 'Ainda não há jogos sincronizados para montar a classificação.'
          : 'Esta competição não tem fase de grupos.'}
      </p>
    )
  }

  const groups = [...standings.keys()].sort((a, b) => a.localeCompare(b))

  return (
    <div className={styles.root}>
      {groups.map((group) => (
        <div key={group} className={styles.group}>
          {isLeagueTable(group) ? (
            <div className={`${styles.groupHeader} ${styles.groupHeaderStatic}`}>
              <span>Classificação</span>
            </div>
          ) : (
            <button
              className={styles.groupHeader}
              onClick={() => {
                trackEvent('click_standings_ver_grupo', { group })
                setSelectedGroup(group)
              }}
            >
              <span>Grupo {group}</span>
              <span className={styles.groupHint}>ver jogos</span>
            </button>
          )}
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
