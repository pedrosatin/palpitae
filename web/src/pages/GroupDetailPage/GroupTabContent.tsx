import { type Tab, type GroupDetail } from './types'
import PredictionsTab from '../../components/PredictionsTab'
import StandingsTab from '../../components/StandingsTab'
import GroupPicksTab from '../../components/GroupPicksTab'
import LeaderboardTab from '../../components/LeaderboardTab'
import MembersTab from '../../components/MembersTab'
import { tiebreakSummary } from '../../lib/groupRules'
import styles from './GroupDetailPage.module.css'

interface GroupTabContentProps {
  activeTab: Tab
  groupId: string
  group: GroupDetail
  showStandings: boolean
  isAdmin: boolean
  userId: string
  onOpenRules?: () => void
  /** Rodada do `?rodada=` da URL, em que a aba Palpitar abre. */
  requestedRound?: string | null
  /** Chamado quando a aba Palpitar abre na rodada pedida, para tirá-la da URL. */
  onRequestedRoundApplied?: () => void
}

export default function GroupTabContent({
  activeTab,
  groupId,
  group,
  showStandings,
  isAdmin,
  userId,
  onOpenRules,
  requestedRound,
  onRequestedRoundApplied,
}: GroupTabContentProps) {
  return (
    <div className={styles.tabContent}>
      {activeTab === 'predictions' && (
        <PredictionsTab
          key={`${userId}:${groupId}`}
          groupId={groupId}
          competitionId={group.competition_id}
          userId={userId}
          pointsExact={group.points_exact}
          initialRound={requestedRound}
          onInitialRoundApplied={onRequestedRoundApplied}
        />
      )}
      {activeTab === 'standings' && showStandings && (
        <StandingsTab
          competitionId={group.competition_id}
          competitionType={group.competition_type}
          competitionCode={group.competition_code}
        />
      )}
      {activeTab === 'group-picks' && (
        <GroupPicksTab
          groupId={groupId}
          competitionId={group.competition_id}
          predictionsVisibility={group.predictions_visibility}
        />
      )}
      {activeTab === 'leaderboard' && (
        <LeaderboardTab
          groupId={groupId}
          currentUserId={userId}
          tiebreakNote={tiebreakSummary(group.points_exact, group.points_winner)}
          onOpenRules={onOpenRules}
        />
      )}
      {activeTab === 'members' && isAdmin && (
        <MembersTab groupId={groupId} currentUserId={userId} />
      )}
    </div>
  )
}
