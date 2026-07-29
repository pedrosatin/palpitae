import { type Tab, type GroupDetail } from './types'
import PredictionsTab from '../../components/PredictionsTab'
import StandingsTab from '../../components/StandingsTab'
import GroupPicksTab from '../../components/GroupPicksTab'
import LeaderboardTab from '../../components/LeaderboardTab'
import MembersTab from '../../components/MembersTab'
import styles from './GroupDetailPage.module.css'

interface GroupTabContentProps {
  activeTab: Tab
  groupId: string
  group: GroupDetail
  showStandings: boolean
  isAdmin: boolean
  userId: string
}

export default function GroupTabContent({
  activeTab,
  groupId,
  group,
  showStandings,
  isAdmin,
  userId,
}: GroupTabContentProps) {
  return (
    <div className={styles.tabContent}>
      {activeTab === 'predictions' && (
        <PredictionsTab
          groupId={groupId}
          competitionId={group.competition_id}
          pointsExact={group.points_exact}
        />
      )}
      {activeTab === 'standings' && showStandings && (
        <StandingsTab
          competitionId={group.competition_id}
          competitionType={group.competition_type}
        />
      )}
      {activeTab === 'group-picks' && (
        <GroupPicksTab groupId={groupId} competitionId={group.competition_id} />
      )}
      {activeTab === 'leaderboard' && <LeaderboardTab groupId={groupId} currentUserId={userId} />}
      {activeTab === 'members' && isAdmin && (
        <MembersTab groupId={groupId} currentUserId={userId} />
      )}
    </div>
  )
}
