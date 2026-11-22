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
  requestedRound?: string | null
  onRequestedRoundApplied?: () => void
  onMemberRemoved?: (userId: string) => void
  onJoinRequestDecided?: (action: 'approve' | 'reject') => void
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
  onMemberRemoved,
  onJoinRequestDecided,
}: GroupTabContentProps) {
  return (
    <div className={styles.tabContent}>
      {activeTab === 'predictions' && (
        <PredictionsTab
          key={`${userId}:${groupId}`}
          groupId={groupId}
          groupName={group.name}
          competitionId={group.competition_id}
          userId={userId}
          pointsExact={group.points_exact}
          initialRound={requestedRound}
          onInitialRoundApplied={onRequestedRoundApplied}
          inviteCode={group.invite_code}
          publicId={group.public_id}
          isOwner={isAdmin}
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
          groupName={group.name}
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
        <MembersTab
          groupId={groupId}
          currentUserId={userId}
          onMemberRemoved={onMemberRemoved}
          onJoinRequestDecided={onJoinRequestDecided}
        />
      )}
    </div>
  )
}
