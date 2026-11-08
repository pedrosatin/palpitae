import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { useMatchRounds } from '../../hooks/useMatchRounds'
import { apiFetch } from '../../lib/api'
import { isMatchLocked } from '../../lib/predictionDrafts'
import { applyDefaultRoundFromMatches, fetchCompetitionMatches } from '../../lib/competitionMatches'
import ErrorState from '../ErrorState'
import type { Match } from '../MatchCard'
import PenaltyBadge from '../PenaltyBadge'
import RoundHeader from '../RoundHeader/RoundHeader'
import styles from './GroupPicksTab.module.css'

interface GroupPicksTabProps {
  groupId: string
  competitionId: string
  predictionsVisibility?: string
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
  classified_points?: number
  predicted_classified?: 'home' | 'away' | null
  penalty_points: number
  locked: 0 | 1
}

interface GroupPicksResponse {
  self_user_id: string
  members: GroupMember[]
  predictions: MemberPrediction[]
}

interface PickRow {
  user_id: string
  user_display: string
  pick: MemberPrediction | null
}

/**
 * Linhas do card. Com o jogo travado (ou num grupo "Sempre visível") o card lista
 * o elenco inteiro, e quem não palpitou entra como "sem palpite". Num grupo com
 * palpites ocultos antes do início, só os palpites que a API devolveu (o do próprio
 * usuário): listar os ausentes ali contaria quem já palpitou antes da hora.
 */
function buildPickRows(
  memberPicks: MemberPrediction[],
  members: GroupMember[],
  showRoster: boolean,
): PickRow[] {
  if (!showRoster) {
    return memberPicks.map((p) => ({ user_id: p.user_id, user_display: p.user_display, pick: p }))
  }
  const byUser = new Map(memberPicks.map((p) => [p.user_id, p]))
  const rows: PickRow[] = members.map((m) => {
    const pick = byUser.get(m.user_id) ?? null
    return { user_id: m.user_id, user_display: pick?.user_display ?? m.display, pick }
  })
  // Palpite de quem não está mais no elenco devolvido (corrida com saída do grupo).
  const rostered = new Set(members.map((m) => m.user_id))
  for (const p of memberPicks) {
    if (!rostered.has(p.user_id)) {
      rows.push({ user_id: p.user_id, user_display: p.user_display, pick: p })
    }
  }
  return rows
}

function MatchPicksCard({
  match,
  memberPicks,
  members,
  selfUserId,
  hidden,
}: {
  match: Match
  memberPicks: MemberPrediction[]
  members: GroupMember[]
  selfUserId: string
  hidden: boolean
}) {
  const isFinished = match.status === 'finished'
  // `locked` vem da API (relógio do servidor): um palpite alheio travado já
  // prova que o jogo começou, mesmo com o relógio local atrasado.
  const isLocked = isMatchLocked(match, undefined) || memberPicks.some((p) => p.locked === 1)
  const rows = buildPickRows(memberPicks, members, isLocked || !hidden)

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

      {rows.length > 0 ? (
        <ul className={styles.pickList}>
          {rows.map(({ user_id, user_display, pick: p }) => {
            const isSelf = user_id === selfUserId
            const total = p
              ? p.points_awarded + (p.penalty_points ?? 0) + (p.classified_points ?? 0)
              : 0
            return (
              <li
                key={user_id}
                className={`${styles.pickRow} ${isSelf ? styles.pickRowSelf : ''}`}
              >
                <span className={styles.pickName}>
                  {user_display}
                  {isSelf && <span className={styles.youTag}> (você)</span>}
                </span>
                {p ? (
                  <PickScore match={match} pick={p} />
                ) : (
                  <span className={styles.noPick}>sem palpite</span>
                )}
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
          {isLocked || !hidden
            ? '📭 Nenhum palpite foi feito para este jogo.'
            : '🔒 Os palpites dos outros membros aparecem quando o jogo começar.'}
        </p>
      )}
      {rows.length > 0 && hidden && !isLocked && (
        <p className={styles.hidden}>
          Os palpites dos outros membros aparecem quando o jogo começar.
        </p>
      )}
    </div>
  )
}

function PickScore({ match, pick: p }: { match: Match; pick: MemberPrediction }) {
  // A draw pick is ambiguous on score alone in a knockout: the
  // penalty winner is what tells two equal scores apart.
  const showPenaltyPick = Boolean(match.decides_on_penalties) && p.predicted_penalty_winner != null
  const penaltyTeam =
    p.predicted_penalty_winner === 'home'
      ? match.home_team_short_name
      : match.away_team_short_name
  return (
    <span className={styles.pickScore}>
      {p.predicted_home_score} × {p.predicted_away_score}
      {p.predicted_classified && (
        <span>
          {' '}
          classificado:{' '}
          {p.predicted_classified === 'home'
            ? match.home_team_short_name
            : match.away_team_short_name}
        </span>
      )}
      {showPenaltyPick && (
        <PenaltyBadge team={penaltyTeam} tooltip="Vencedor previsto nos pênaltis" />
      )}
    </span>
  )
}

export default function GroupPicksTab({
  groupId,
  competitionId,
  predictionsVisibility = 'hidden',
}: GroupPicksTabProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [picks, setPicks] = useState<GroupPicksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCompetitionMatches(competitionId),
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

        applyDefaultRoundFromMatches(matchesData.matches, matchesData.default_round, setRoundIndex)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId, competitionId])

  const { roundKeys, safeIndex, selectedRound, roundMatches, labelFor, prev, next } =
    useMatchRounds(matches, roundIndex, setRoundIndex, {
      prev: 'click_group_picks_rodada_anterior',
      next: 'click_group_picks_proxima_rodada',
    })

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
            members={picks.members ?? []}
            selfUserId={picks.self_user_id}
            hidden={predictionsVisibility === 'hidden'}
          />
        ))}
      </div>
    </div>
  )
}
