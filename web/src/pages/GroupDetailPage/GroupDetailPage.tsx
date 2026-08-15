import { useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import CreateGroupModal from '../../components/CreateGroupModal'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import GroupHeader from './GroupHeader'
import GroupInviteSection from './GroupInviteSection'
import RenameGroupModal from './RenameGroupModal'
import ErrorState from '../../components/ErrorState'
import { invalidateApiCache } from '../../lib/api-cache'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import styles from './GroupDetailPage.module.css'
import { type User, TAB_LABELS } from './types'
import GroupTabs from './GroupTabs'
import GroupTabContent from './GroupTabContent'
import { useGroupDetail, useGroupTabs, useTabsOffset, useGroupActions } from './hooks'
import { trackEvent } from '../../analytics/ga'

interface GroupDetailPageProps {
  user: User
  onLogout: () => void
}

export default function GroupDetailPage({ user, onLogout }: GroupDetailPageProps) {
  const navigate = useNavigate()
  const { groupId } = useParams<{ groupId: string }>()

  const { group, setGroup, loading, error } = useGroupDetail(groupId)
  const { activeTab, showStandings, tabHref, handleTabClick } = useGroupTabs(group)
  const tabsOffset = useTabsOffset()
  const { leaveGroup, leaving, deleteGroup, deleting, confirmDialog } = useGroupActions(groupId, user)

  const [renameOpen, setRenameOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const isAdmin = group?.is_admin ?? false

  useDocumentTitle(group ? `${group.name} — ${TAB_LABELS[activeTab]}` : undefined)

  if (!groupId) return <Navigate to="/" replace />

  function handleGroupCreated(nextGroup: { id: string }) {
    invalidateApiCache('groups:')
    navigate(`/grupos/${nextGroup.id}`)
  }

  function handleGroupJoined(nextGroup: { id: string }) {
    invalidateApiCache('groups:')
    navigate(`/grupos/${nextGroup.id}`)
  }

  function openRename() {
    if (!group) return
    trackEvent('click_group_detail_menu_editar_nome')
    setRenameOpen(true)
  }

  const modals = (
    <>
      <CreateGroupModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleGroupCreated}
      />
      <JoinGroupModal
        isOpen={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={handleGroupJoined}
      />
      <RenameGroupModal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        groupId={groupId!}
        currentName={group?.name ?? ''}
        onRenamed={(name) => setGroup((prev) => (prev ? { ...prev, name } : prev))}
      />
      {confirmDialog}
    </>
  )

  if (loading) {
    return (
      <>
        <Header
          user={user}
          onCreateGroup={() => setCreateOpen(true)}
          onJoinGroup={() => setJoinOpen(true)}
          onLogout={onLogout}
        />
        <main className={styles.root}>
          <p className={styles.loadingText}>Carregando grupo...</p>
        </main>
        {modals}
      </>
    )
  }

  if (error || !group) {
    return (
      <>
        <Header
          user={user}
          onCreateGroup={() => setCreateOpen(true)}
          onJoinGroup={() => setJoinOpen(true)}
          onLogout={onLogout}
        />
        <main className={styles.root}>
          <ErrorState message={error ?? 'Grupo não encontrado'} />
        </main>
        {modals}
      </>
    )
  }

  return (
    <>
      <Header
        user={user}
        onCreateGroup={() => setCreateOpen(true)}
        onJoinGroup={() => setJoinOpen(true)}
        onLogout={onLogout}
      />
      <main className={styles.root}>
        {/* Group header */}
        <GroupHeader
          group={group}
          isAdmin={isAdmin}
          onOpenRename={openRename}
          onDeleteGroup={deleteGroup}
          deleting={deleting}
          onLeaveGroup={leaveGroup}
          leaving={leaving}
        />

        {/* Admin: invite section */}
        {isAdmin && <GroupInviteSection inviteCode={group.invite_code} />}

        {/* Tabs */}
        <GroupTabs
          activeTab={activeTab}
          showStandings={showStandings}
          isAdmin={isAdmin}
          tabsOffset={tabsOffset}
          tabHref={tabHref}
          onTabClick={handleTabClick}
        />

        <GroupTabContent
          activeTab={activeTab}
          groupId={groupId}
          group={group}
          showStandings={showStandings}
          isAdmin={isAdmin}
          userId={user.id}
        />
      </main>
      {modals}
    </>
  )
}
