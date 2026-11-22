import { trackEvent } from '../../analytics/ga'
import { roundReminder, type GroupMember } from '../../lib/groupReminder'
import { formatMatchDate } from '../../lib/matchTime'
import { pickPoints } from '../../lib/roundSummary'
import ErrorState from '../ErrorState'
import { isResultOverdue } from '../../lib/resultOverdue'
import { teamShortName, type Match } from '../MatchCard/types'
import PenaltyBadge from '../PenaltyBadge'
import RoundHeader from '../RoundHeader/RoundHeader'
import { MatchPickers, RoundReminderSummary } from './GroupPicksPresence'
import styles from './GroupPicksTab.module.css'
import {
  groupPredictionsByMatch,
  isMatchOpenForPicks,
  pickersOfMatch,
  serverConfirmsLock,
  useGroupPicksTab,
  type MemberPrediction,
} from './useGroupPicksTab'

interface GroupPicksTabProps {
  groupId: string
  competitionId: string
  groupName?: string
  predictionsVisibility?: string
}

interface PickRow {
  user_id: string
  user_display: string
  pick: MemberPrediction | null
}

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
  open,
  pickers,
  now,
}: {
  match: Match
  memberPicks: MemberPrediction[]
  members: GroupMember[]
  selfUserId: string
  hidden: boolean
  open: boolean
  pickers: GroupMember[] | null
  now: number
}) {
  const isFinished = match.status === 'finished'
  const serverLocked = serverConfirmsLock(match, memberPicks)
  const rows = buildPickRows(memberPicks, members, serverLocked || !hidden)
  const resultPending = isResultOverdue(match, now)

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

      {open && (
        <p className={styles.matchTime}>
          {match.postponed ? 'data a definir' : formatMatchDate(match.start_time)}
        </p>
      )}
      {resultPending && (
        <p className={styles.resultPending} title="Placar ainda não confirmado pelo provedor">
          resultado pendente
        </p>
      )}
      {open && pickers && (
        <MatchPickers
          pickers={pickers}
          memberCount={members.length}
          selfUserId={selfUserId}
          showInitials={hidden}
        />
      )}

      {rows.length > 0 ? (
        <ul className={styles.pickList}>
          {rows.map(({ user_id, user_display, pick: p }) => {
            const isSelf = user_id === selfUserId
            const total = p ? pickPoints(p) : 0
            return (
              <li key={user_id} className={`${styles.pickRow} ${isSelf ? styles.pickRowSelf : ''}`}>
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
        !open && (
          <p className={styles.hidden}>
            🔒 Os palpites dos outros membros aparecem quando o jogo começar.
          </p>
        )
      )}
    </div>
  )
}

function PickScore({ match, pick: p }: { match: Match; pick: MemberPrediction }) {
  const penaltyTeam = teamShortName(match, p.predicted_penalty_winner)
  const classifiedTeam = teamShortName(match, p.predicted_classified)
  const showPenaltyPick = Boolean(match.decides_on_penalties) && penaltyTeam !== null
  return (
    <span className={styles.pickScore}>
      {p.predicted_home_score} × {p.predicted_away_score}
      {classifiedTeam !== null && <span> classificado: {classifiedTeam}</span>}
      {showPenaltyPick && (
        <PenaltyBadge team={penaltyTeam} tooltip="Vencedor previsto nos pênaltis" />
      )}
    </span>
  )
}

export default function GroupPicksTab({
  groupId,
  competitionId,
  groupName = '',
  predictionsVisibility = 'hidden',
}: GroupPicksTabProps) {
  const {
    picks,
    loading,
    error,
    matches,
    now,
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    knockoutRounds,
    prev,
    next,
    setRoundIndex,
  } = useGroupPicksTab(groupId, competitionId, predictionsVisibility)

  if (loading) {
    return <p className={styles.loading}>Carregando palpites do grupo...</p>
  }

  if (error) {
    return <ErrorState message={error} />
  }

  if (matches.length === 0 || !picks) {
    return <p className={styles.empty}>Nenhum jogo encontrado para esta competição.</p>
  }

  const picksByMatch = groupPredictionsByMatch(picks.predictions)
  const members = picks.members ?? []
  const openPickers = picks.open_pickers
  const hidden = predictionsVisibility === 'hidden'
  const openMatches = roundMatches.filter((match) =>
    isMatchOpenForPicks(match, picksByMatch.get(match.id) ?? [], now),
  )
  const reminder = openPickers ? roundReminder(openMatches, members, openPickers) : null
  const showHiddenNotice = hidden && openMatches.length > 0

  return (
    <div className={styles.root}>
      <RoundHeader
        id="picks-round-select"
        safeIndex={safeIndex}
        selectedRound={selectedRound}
        roundKeys={roundKeys}
        labelFor={labelFor}
        knockoutRounds={knockoutRounds}
        onPrev={prev}
        onNext={next}
        onSelect={(round) => {
          trackEvent('change_group_picks_rodada', { round })
          setRoundIndex(roundKeys.indexOf(round))
        }}
      />

      {(reminder || showHiddenNotice) && (
        <section className={styles.roundSummary} aria-label="Palpites da rodada">
          {reminder && (
            <RoundReminderSummary
              reminder={reminder}
              selfUserId={picks.self_user_id}
              groupId={groupId}
              groupName={groupName}
              round={selectedRound}
              roundLabel={labelFor(selectedRound)}
            />
          )}
          {showHiddenNotice && (
            <p className={styles.hidden}>
              Os palpites dos outros membros aparecem quando o jogo começar.
            </p>
          )}
        </section>
      )}

      <div className={styles.matchList}>
        {roundMatches.map((match) => {
          const memberPicks = picksByMatch.get(match.id) ?? []
          const open = isMatchOpenForPicks(match, memberPicks, now)
          return (
            <MatchPicksCard
              key={match.id}
              match={match}
              memberPicks={memberPicks}
              members={members}
              selfUserId={picks.self_user_id}
              hidden={hidden}
              open={open}
              pickers={pickersOfMatch(match, openPickers, members, open)}
              now={now}
            />
          )
        })}
      </div>
    </div>
  )
}
