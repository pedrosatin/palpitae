import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { fetchCachedJson } from '../../lib/api-cache'
import { type Match } from '../MatchCard'
import Modal from '../Modal'
import styles from './StandingsTab.module.css'

interface StandingsTabProps {
  competitionId: string
}

export interface TeamStanding {
  team_id: string
  team_name: string
  team_short_name: string
  team_logo: string
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

  // Chave '' = tabela única de liga (pontos corridos). Copa: agrupa por group_name
  // (fase de grupos) e ignora mata-mata (group_name null fora de REGULAR_SEASON).
  const LEAGUE = ''

  for (const m of matches) {
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

    if (
      m.status !== 'finished' ||
      m.home_score === null ||
      m.away_score === null
    ) {
      continue
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
  }

  const result = new Map<string, TeamStanding[]>()
  for (const [group, teams] of byGroup) {
    // Liga (CBF): pontos, VITÓRIAS, saldo, gols pró. Copa (FIFA): pontos, saldo, gols pró.
    const isLeague = group === LEAGUE
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

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export default function StandingsTab({ competitionId }: StandingsTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchCachedJson(
      `matches:${competitionId}`,
      () =>
        fetch(
          `${config.apiUrl}/matches?competition_id=${encodeURIComponent(competitionId)}`,
          { credentials: 'include' },
        ).then((r) => {
          if (!r.ok) throw new Error('Erro ao carregar jogos')
          return r.json() as Promise<{
            matches: Match[]
            default_round: string | null
          }>
        }),
      30_000,
    )
      .then((data) => setMatches(data.matches))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [competitionId])

  if (loading) {
    return <p className={styles.loading}>Carregando classificação...</p>
  }

  if (error) {
    return <p className={styles.error}>{error}</p>
  }

  const standings = computeStandings(matches)

  if (standings.size === 0) {
    return (
      <p className={styles.empty}>
        Esta competição não tem fase de grupos.
      </p>
    )
  }

  const groups = [...standings.keys()].sort((a, b) => a.localeCompare(b))

  const selectedMatches =
    selectedGroup === null
      ? []
      : matches
          .filter((m) => m.group_name === selectedGroup)
          .sort((a, b) => (a.start_time < b.start_time ? -1 : 1))

  return (
    <div className={styles.root}>
      {groups.map((group) => (
        <div key={group} className={styles.group}>
          {group === '' ? (
            <div className={`${styles.groupHeader} ${styles.groupHeaderStatic}`}>
              <span>Classificação</span>
            </div>
          ) : (
            <button
              className={styles.groupHeader}
              onClick={() => { trackEvent('click_standings_ver_grupo', { group }); setSelectedGroup(group) }}
            >
              <span>Grupo {group}</span>
              <span className={styles.groupHint}>ver jogos</span>
            </button>
          )}
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
                </tr>
              </thead>
              <tbody>
                {standings.get(group)!.map((t, i) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <Modal
        isOpen={selectedGroup !== null}
        onClose={() => setSelectedGroup(null)}
        title={`Grupo ${selectedGroup}`}
      >
        <ul className={styles.matchList}>
          {selectedMatches.map((m) => (
            <li key={m.id} className={styles.matchItem}>
              {m.status === 'scheduled' ? (
                <>
                  <span className={styles.matchTeams}>
                    {m.home_team_short_name} vs {m.away_team_short_name}
                  </span>
                  <span className={styles.matchInfo}>
                    {formatDay(m.start_time)}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.matchTeams}>
                    {m.home_team_short_name} {m.home_score ?? '–'} ×{' '}
                    {m.away_score ?? '–'} {m.away_team_short_name}
                  </span>
                  <span className={styles.matchInfo}>
                    {formatDay(m.start_time)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}
