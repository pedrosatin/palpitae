import { useCallback, useMemo, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { useGroupMembers } from '../../hooks/useGroupMembers'
import { useRoundStandings, type RoundStanding } from '../../hooks/useRoundStandings'
import {
  achievedExactMilestones,
  exactMilestoneBadgeLabel,
  exactMilestonesTitle,
  highestExactMilestoneFromHits,
  type ExactMilestone,
} from '../../lib/exactMilestones'
import {
  UNLIKELY_EXACT_BADGE_LABEL,
  unlikelyExactBadgeTitle,
} from '../../lib/unlikelyExact'
import Avatar from '../Avatar'
import ErrorState from '../ErrorState'
import MemberBadge from '../MemberBadge'
import PredictionsModal from './PredictionsModal'
import styles from './LeaderboardTab.module.css'
import type { Member } from './types'

interface LeaderboardTabProps {
  groupId: string
  currentUserId: string
  tiebreakNote?: string
  onOpenRules?: () => void
}

const STREAK_BADGE_MIN = 3

function roundKings(standings: RoundStanding[]): Set<string> {
  const top = Math.max(0, ...standings.map((standing) => standing.round_points))
  if (top === 0) return new Set()
  return new Set(
    standings.filter((standing) => standing.round_points === top).map((s) => s.user_id),
  )
}

function MemberBadges({
  isOwner,
  isSelf,
  isKing,
  streak,
  exactMilestone,
  exactHits,
  unlikelyExact,
}: {
  isOwner: boolean
  isSelf: boolean
  isKing: boolean
  streak: number
  exactMilestone: ExactMilestone | null
  exactHits: number
  unlikelyExact: boolean
}) {
  const showStreak = streak >= STREAK_BADGE_MIN
  if (!isOwner && !isSelf && !isKing && !showStreak && !exactMilestone && !unlikelyExact) {
    return null
  }
  const streakLabel = `${streak} rodadas seguidas com todos os jogos palpitados`
  const milestoneTitle = exactMilestone
    ? exactMilestonesTitle(achievedExactMilestones(exactHits))
    : ''
  const unlikelyTitle = unlikelyExactBadgeTitle()
  return (
    <span className={styles.badges}>
      {isOwner && <MemberBadge variant="owner" className={styles.memberBadge} />}
      {isSelf && <MemberBadge variant="self" className={styles.memberBadge} />}
      {isKing && <span className={styles.kingBadge}>rei da rodada</span>}
      {showStreak && (
        <span className={styles.streakBadge} title={streakLabel}>
          <span aria-hidden="true">{`${streak} seguidas`}</span>
          <span className="sr-only">{streakLabel}</span>
        </span>
      )}
      {exactMilestone && (
        <span className={styles.milestoneBadge} title={milestoneTitle}>
          <span aria-hidden="true">{exactMilestoneBadgeLabel(exactMilestone)}</span>
          <span className="sr-only">{milestoneTitle}</span>
        </span>
      )}
      {unlikelyExact && (
        <span className={styles.unlikelyBadge} title={unlikelyTitle}>
          <span aria-hidden="true">{UNLIKELY_EXACT_BADGE_LABEL}</span>
          <span className="sr-only">{unlikelyTitle}</span>
        </span>
      )}
    </span>
  )
}

function RoundPoints({ standing }: { standing: RoundStanding | undefined }) {
  if (!standing) {
    return (
      <>
        <span aria-hidden="true">–</span>
        <span className="sr-only">sem dados da rodada</span>
      </>
    )
  }
  return <>{standing.round_points > 0 ? `+${standing.round_points}` : standing.round_points}</>
}

function PositionChange({ change }: { change: number | null | undefined }) {
  if (!change) return null
  const up = change > 0
  const places = Math.abs(change)
  return (
    <span className={`${styles.positionChange} ${up ? styles.changeUp : styles.changeDown}`}>
      <span aria-hidden="true">
        {up ? '▲' : '▼'}
        {places}
      </span>
      <span className="sr-only">
        {` — ${up ? 'subiu' : 'caiu'} ${places} ${places === 1 ? 'posição' : 'posições'}`}
      </span>
    </span>
  )
}

export default function LeaderboardTab({
  groupId,
  currentUserId,
  tiebreakNote,
  onOpenRules,
}: LeaderboardTabProps) {
  const { members, loading, error } = useGroupMembers(groupId)
  const { round, standings, loading: roundLoading } = useRoundStandings(groupId)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)

  const standingByUser = useMemo(
    () => new Map(standings.map((standing) => [standing.user_id, standing])),
    [standings],
  )
  const kings = useMemo(() => roundKings(standings), [standings])
  const showArrowsNote = round !== null && standings.some((s) => Boolean(s.position_change))

  const openMemberModal = useCallback((member: Member) => {
    trackEvent('click_leaderboard_ver_palpites')
    setSelectedMember(member)
  }, [])

  const closeModal = useCallback(() => {
    setSelectedMember(null)
  }, [])

  if (error) {
    return <ErrorState message={error} />
  }

  if (loading || roundLoading) {
    return <p className={styles.loading}>Carregando classificação...</p>
  }

  if (members.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Nenhum membro encontrado.</p>
      </div>
    )
  }

  return (
    <>
      <div className={styles.root}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPos}>#</th>
              <th className={styles.thName}>Jogador</th>
              {round !== null && (
                <th className={styles.thRound}>
                  <span className={styles.labelLong} aria-hidden="true">
                    {`Rodada ${round}`}
                  </span>
                  <abbr
                    className={styles.labelShort}
                    title={`Pontos na rodada ${round}`}
                    aria-hidden="true"
                  >
                    {`R${round}`}
                  </abbr>
                  <span className="sr-only">{`Pontos na rodada ${round}`}</span>
                </th>
              )}
              <th className={styles.thPts}>
                <span className={styles.labelLong} aria-hidden="true">
                  Pontos
                </span>
                <abbr className={styles.labelShort} title="Pontos" aria-hidden="true">
                  Pts
                </abbr>
                <span className="sr-only">Pontos</span>
              </th>
              <th className={styles.thExact}>
                <span className={styles.labelLong} aria-hidden="true">
                  Exatos
                </span>
                <abbr className={styles.labelShort} title="Placares exatos" aria-hidden="true">
                  Ex.
                </abbr>
                <span className="sr-only">Placares exatos</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, index) => (
              <tr
                key={member.user_id}
                className={member.user_id === currentUserId ? styles.rowSelf : styles.row}
                onClick={() => openMemberModal(member)}
                title={`Ver palpites de ${member.display_name}`}
              >
                <td className={styles.tdPos}>
                  {index + 1}
                  <PositionChange change={standingByUser.get(member.user_id)?.position_change} />
                </td>
                <td className={styles.tdName}>
                  <div className={styles.nameCell}>
                    <Avatar
                      name={member.display_name}
                      src={member.avatar_url}
                      className={styles.avatar}
                    />
                    <div className={styles.nameBody}>
                      <span className={styles.displayName}>{member.display_name}</span>
                      <MemberBadges
                        isOwner={member.role === 'owner'}
                        isSelf={member.user_id === currentUserId}
                        isKing={kings.has(member.user_id)}
                        streak={standingByUser.get(member.user_id)?.streak ?? 0}
                        exactMilestone={highestExactMilestoneFromHits(member.exact_hits)}
                        exactHits={member.exact_hits}
                        unlikelyExact={
                          standingByUser.get(member.user_id)?.unlikely_exact === true
                        }
                      />
                    </div>
                  </div>
                </td>
                {round !== null && (
                  <td className={styles.tdRound}>
                    <RoundPoints standing={standingByUser.get(member.user_id)} />
                  </td>
                )}
                <td className={styles.tdPts}>{member.total_points}</td>
                <td className={styles.tdExact}>{member.exact_hits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(tiebreakNote || onOpenRules || showArrowsNote) && (
        <p className={styles.rulesNote}>
          {tiebreakNote && <span>{tiebreakNote}</span>}
          {showArrowsNote && (
            <span>{`As setas comparam com a posição antes da rodada ${round}.`}</span>
          )}
          {onOpenRules && (
            <button
              type="button"
              className={styles.rulesLink}
              onClick={() => {
                trackEvent('click_leaderboard_como_pontua')
                onOpenRules()
              }}
            >
              Como pontua
            </button>
          )}
        </p>
      )}

      {selectedMember && (
        <PredictionsModal member={selectedMember} groupId={groupId} onClose={closeModal} />
      )}
    </>
  )
}
