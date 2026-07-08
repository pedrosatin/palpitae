import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { fetchCachedJson } from '../../lib/api-cache'
import { applyDefaultRound, isGroupStageRound } from '../../lib/rounds'
import type { Match } from '../MatchCard'
import PenaltyBadge from '../PenaltyBadge'
import styles from './GroupPicksTab.module.css'

interface GroupPicksTabProps {
  groupId: string
  competitionId: string
}

interface GroupMember {
  user_id: string
  display: string
}

interface MemberPrediction {
  match_id: string
  user_id: string
  user_display: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner: 'home' | 'away' | null
  points_awarded: number
  penalty_points: number
  locked: 0 | 1
}

interface GroupPicksResponse {
  self_user_id: string
  members: GroupMember[]
  predictions: MemberPrediction[]
}

async function fetchMatches(competitionId: string) {
  return fetchCachedJson(
    `matches:${competitionId}`,
    async () => {
      const r = await fetch(
        `${config.apiUrl}/matches?competition_id=${encodeURIComponent(competitionId)}`,
        { credentials: 'include' },
      )
      if (!r.ok) throw new Error('Erro ao carregar jogos')
      return r.json() as Promise<{ matches: Match[]; default_round: string | null }>
    },
    30_000,
  )
}

async function fetchGroupPicks(groupId: string) {
  const r = await fetch(
    `${config.apiUrl}/predictions/group?group_id=${encodeURIComponent(groupId)}`,
    { credentials: 'include' },
  )
  if (!r.ok) throw new Error('Erro ao carregar palpites do grupo')
  return r.json() as Promise<GroupPicksResponse>
}

export default function GroupPicksTab({
  groupId,
  competitionId,
}: GroupPicksTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [picks, setPicks] = useState<GroupPicksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const [matchesData, picksData] = await Promise.all([
          fetchMatches(competitionId),
          fetchGroupPicks(groupId),
        ])

        setMatches(matchesData.matches)
        setPicks(picksData)

        const keys = [...new Set(matchesData.matches.map((m) => m.round))]
        applyDefaultRound(matchesData.default_round, keys, setRoundIndex)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [groupId, competitionId])

  if (loading) {
    return <p className={styles.loading}>Carregando palpites do grupo...</p>
  }

  if (error) {
    return <p className={styles.error}>{error}</p>
  }

  if (matches.length === 0 || !picks) {
    return (
      <p className={styles.empty}>
        Nenhum jogo encontrado para esta competição.
      </p>
    )
  }

  // match_id → members' predictions (already filtered by the reveal rule on the API)
  const picksByMatch = new Map<string, MemberPrediction[]>()
  for (const p of picks.predictions) {
    if (!picksByMatch.has(p.match_id)) picksByMatch.set(p.match_id, [])
    picksByMatch.get(p.match_id)!.push(p)
  }

  // Group matches by round
  const rounds = new Map<string, Match[]>()
  for (const m of matches) {
    if (!rounds.has(m.round)) rounds.set(m.round, [])
    rounds.get(m.round)!.push(m)
  }

  const roundKeys = Array.from(rounds.keys())
  const safeIndex = Math.min(roundIndex, roundKeys.length - 1)
  const selectedRound = roundKeys[safeIndex]
  const roundMatches = rounds.get(selectedRound) ?? []

  const labelFor = (r: string) => rounds.get(r)?.[0]?.round_label ?? r

  function prev() {
    trackEvent('click_group_picks_rodada_anterior', { round: roundKeys[Math.max(0, safeIndex - 1)] })
    setRoundIndex((i) => Math.max(0, i - 1))
  }

  function next() {
    trackEvent('click_group_picks_proxima_rodada', { round: roundKeys[Math.min(roundKeys.length - 1, safeIndex + 1)] })
    setRoundIndex((i) => Math.min(roundKeys.length - 1, i + 1))
  }

  return (
    <div className={styles.root}>
      <div className={styles.roundNav}>
        <button
          className={styles.navBtn}
          onClick={prev}
          disabled={safeIndex === 0}
          aria-label="Rodada anterior"
        >
          ‹ Anterior
        </button>
        <select
          id="picks-round-select"
          name="picks-round-select"
          className={styles.roundSelect}
          value={selectedRound}
          onChange={(e) => {
            trackEvent('change_group_picks_rodada', { round: e.target.value })
            setRoundIndex(roundKeys.indexOf(e.target.value))
          }}
        >
          {roundKeys.some((r) => !isGroupStageRound(r)) ? (
            <>
              {roundKeys.some(isGroupStageRound) && (
                <optgroup label="Fase de grupos">
                  {roundKeys.filter(isGroupStageRound).map((r) => (
                    <option key={r} value={r}>{labelFor(r)}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Mata-mata">
                {roundKeys.filter((r) => !isGroupStageRound(r)).map((r) => (
                  <option key={r} value={r}>{labelFor(r)}</option>
                ))}
              </optgroup>
            </>
          ) : (
            roundKeys.map((r) => (
              <option key={r} value={r}>{labelFor(r)}</option>
            ))
          )}
        </select>
        <button
          className={styles.navBtn}
          onClick={next}
          disabled={safeIndex === roundKeys.length - 1}
          aria-label="Próxima rodada"
        >
          Próxima ›
        </button>
      </div>

      <div className={styles.matchList}>
        {roundMatches.map((match) => {
          const memberPicks = picksByMatch.get(match.id) ?? []
          const revealed = memberPicks.length > 0
          const isFinished = match.status === 'finished'
          const isLocked = isFinished || new Date() >= new Date(match.start_time)

          return (
            <div key={match.id} className={styles.matchCard}>
              <div className={styles.matchHeader}>
                <span className={styles.team}>
                  <img
                    className={styles.crest}
                    src={match.home_team_logo}
                    alt={match.home_team_short_name}
                    loading="lazy"
                  />
                  {match.home_team_short_name}
                </span>
                {isFinished ? (
                  <span className={styles.finalScore}>
                    {match.home_score ?? '–'} × {match.away_score ?? '–'}
                  </span>
                ) : (
                  <span className={styles.vs}>×</span>
                )}
                <span className={`${styles.team} ${styles.teamAway}`}>
                  {match.away_team_short_name}
                  <img
                    className={styles.crest}
                    src={match.away_team_logo}
                    alt={match.away_team_short_name}
                    loading="lazy"
                  />
                </span>
              </div>

              {revealed ? (
                <ul className={styles.pickList}>
                  {memberPicks.map((p) => {
                    const isSelf = p.user_id === picks.self_user_id
                    // A draw pick is ambiguous on score alone in a knockout: the
                    // penalty winner is what tells two equal scores apart.
                    const showPenaltyPick =
                      Boolean(match.decides_on_penalties) &&
                      p.predicted_home_score === p.predicted_away_score &&
                      p.predicted_penalty_winner != null
                    const penaltyTeam =
                      p.predicted_penalty_winner === 'home'
                        ? match.home_team_short_name
                        : match.away_team_short_name
                    const total = p.points_awarded + (p.penalty_points ?? 0)
                    return (
                      <li
                        key={p.user_id}
                        className={`${styles.pickRow} ${isSelf ? styles.pickRowSelf : ''}`}
                      >
                        <span className={styles.pickName}>
                          {p.user_display}
                          {isSelf && (
                            <span className={styles.youTag}> (você)</span>
                          )}
                        </span>
                        <span className={styles.pickScore}>
                          {p.predicted_home_score} × {p.predicted_away_score}
                          {showPenaltyPick && (
                            <PenaltyBadge
                              team={penaltyTeam}
                              tooltip="Vencedor previsto nos pênaltis"
                            />
                          )}
                        </span>
                        {isFinished && (
                          <span
                            className={`${styles.pickPoints} ${total > 0 ? styles.pointsGreen : styles.pointsZero}`}
                          >
                            {total} pt
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className={styles.hidden}>
                  {isLocked
                    ? '📭 Nenhum palpite foi feito para este jogo.'
                    : '🔒 Faça seu palpite na aba Palpitar para ver os palpites dos outros membros.'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
