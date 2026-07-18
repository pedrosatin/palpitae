import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { fetchCachedJson } from '../../lib/api-cache'
import { applyDefaultRound } from '../../lib/rounds'
import ErrorState from '../ErrorState'
import type { Match } from '../MatchCard'
import PenaltyBadge from '../PenaltyBadge'
import RoundHeader from '../RoundHeader/RoundHeader'
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

function MatchPicksCard({
  match,
  memberPicks,
  selfUserId,
}: {
  match: Match
  memberPicks: MemberPrediction[]
  selfUserId: string
}) {
  const revealed = memberPicks.length > 0
  const isFinished = match.status === 'finished'
  const isLocked = isFinished || new Date() >= new Date(match.start_time)

  return (
    <div className={styles.matchCard}>
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
            const isSelf = p.user_id === selfUserId
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
                  {isSelf && <span className={styles.youTag}> (você)</span>}
                </span>
                <span className={styles.pickScore}>
                  {p.predicted_home_score} × {p.predicted_away_score}
                  {showPenaltyPick && (
                    <PenaltyBadge team={penaltyTeam} tooltip="Vencedor previsto nos pênaltis" />
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
}

export default function GroupPicksTab({ groupId, competitionId }: GroupPicksTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [picks, setPicks] = useState<GroupPicksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCachedJson(
        `matches:${competitionId}`,
        () =>
          apiFetch(
            `${config.apiUrl}/matches?competition_id=${encodeURIComponent(competitionId)}`,
          ).then((r) => {
            if (!r.ok) throw new Error('Erro ao carregar jogos')
            return r.json() as Promise<{
              matches: Match[]
              default_round: string | null
            }>
          }),
        30_000,
      ),
      apiFetch(`${config.apiUrl}/predictions/group?group_id=${encodeURIComponent(groupId)}`).then(
        (r) => {
          if (!r.ok) throw new Error('Erro ao carregar palpites do grupo')
          return r.json() as Promise<GroupPicksResponse>
        },
      ),
    ])
      .then(([matchesData, picksData]) => {
        setMatches(matchesData.matches)
        setPicks(picksData)

        const keys = [...new Set(matchesData.matches.map((m) => m.round))]
        applyDefaultRound(matchesData.default_round, keys, setRoundIndex)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, competitionId])

  if (loading) {
    return <p className={styles.loading}>Carregando palpites do grupo...</p>
  }

  if (error) {
    return <ErrorState message={error} />
  }

  if (matches.length === 0 || !picks) {
    return <p className={styles.empty}>Nenhum jogo encontrado para esta competição.</p>
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
    trackEvent('click_group_picks_rodada_anterior', {
      round: roundKeys[Math.max(0, safeIndex - 1)],
    })
    setRoundIndex((i) => Math.max(0, i - 1))
  }

  function next() {
    trackEvent('click_group_picks_proxima_rodada', {
      round: roundKeys[Math.min(roundKeys.length - 1, safeIndex + 1)],
    })
    setRoundIndex((i) => Math.min(roundKeys.length - 1, i + 1))
  }

  return (
    <div className={styles.root}>
      <RoundHeader
        id="picks-round-select"
        safeIndex={safeIndex}
        selectedRound={selectedRound}
        roundKeys={roundKeys}
        labelFor={labelFor}
        onPrev={prev}
        onNext={next}
        onSelect={(round) => {
          trackEvent('change_group_picks_rodada', { round })
          setRoundIndex(roundKeys.indexOf(round))
        }}
      />

      <div className={styles.matchList}>
        {roundMatches.map((match) => (
          <MatchPicksCard
            key={match.id}
            match={match}
            memberPicks={picksByMatch.get(match.id) ?? []}
            selfUserId={picks.self_user_id}
          />
        ))}
      </div>
    </div>
  )
}
