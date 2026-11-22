import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, Navigate } from 'react-router-dom'
import CreateGroupModal from '../../components/CreateGroupModal'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import GroupRulesModal from '../../components/GroupRulesModal'
import GroupHeader from './GroupHeader'
import GroupInviteSection from './GroupInviteSection'
import GroupLinkSection from './GroupLinkSection'
import RenameGroupModal from './RenameGroupModal'
import ErrorState from '../../components/ErrorState'
import ErrorBoundary, { TabError } from '../../components/ErrorBoundary'
import { apiFetch } from '../../lib/api'
import { buildApiUrl } from '../../config'
import { groupsQueryKey } from '../../lib/groupsList'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import styles from './GroupDetailPage.module.css'
import { type User, TAB_LABELS, isGroupId, parseGroupDetail } from './types'
import GroupTabs from './GroupTabs'
import GroupTabContent from './GroupTabContent'
import { useGroupDetail, useGroupTabs, useTabsOffset, useGroupActions } from './hooks'
import { trackEvent } from '../../analytics/ga'

interface GroupDetailPageProps {
  user: User
  onLogout: () => void
}

const JOINED_NOTICE_MS = 6000

interface GroupPageFrameProps extends GroupDetailPageProps {
  modals?: ReactNode
  children: ReactNode
}

function GroupPageFrame({ user, onLogout, modals, children }: GroupPageFrameProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  function openGroup(nextGroup: { id: string }) {
    void queryClient.invalidateQueries({ queryKey: groupsQueryKey, refetchType: 'none' })
    navigate(`/grupos/${nextGroup.id}`)
  }

  return (
    <>
      <Header
        user={user}
        onCreateGroup={() => setCreateOpen(true)}
        onJoinGroup={() => setJoinOpen(true)}
        onLogout={onLogout}
      />
      <main className={styles.root}>{children}</main>
      <CreateGroupModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={openGroup}
      />
      <JoinGroupModal isOpen={joinOpen} onClose={() => setJoinOpen(false)} onJoined={openGroup} />
      {modals}
    </>
  )
}

function GroupNotFound() {
  useDocumentTitle(undefined)
  return (
    <>
      <ErrorState message="Grupo não encontrado" />
      <Link to="/" className={styles.backLink}>
        ← Voltar para Meus grupos
      </Link>
    </>
  )
}

/**
 * Lê o id da rota. Id ausente volta para a home e id com formato inválido mostra
 * "Grupo não encontrado", então nenhuma requisição sai para a API com ele.
 */
export default function GroupDetailPage({ user, onLogout }: GroupDetailPageProps) {
  const { groupId } = useParams<{ groupId: string }>()

  if (!groupId) return <Navigate to="/" replace />

  if (!isGroupId(groupId)) {
    return (
      <GroupPageFrame user={user} onLogout={onLogout}>
        <GroupNotFound />
      </GroupPageFrame>
    )
  }

  return <GroupDetailContent groupId={groupId} user={user} onLogout={onLogout} />
}

interface GroupDetailContentProps extends GroupDetailPageProps {
  groupId: string
}

function GroupDetailContent({ groupId, user, onLogout }: GroupDetailContentProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const { group, setGroup, loading, error } = useGroupDetail(groupId)
  const { activeTab, showStandings, tabHref, handleTabClick, requestedRound, clearRequestedRound } =
    useGroupTabs(group)
  const tabsOffset = useTabsOffset()
  const {
    leaveGroup,
    leaving,
    deleteGroup,
    deleting,
    rotateInvite,
    rotatingInvite,
    confirmDialog,
  } = useGroupActions(groupId, user)

  const [settingsVersion, setSettingsVersion] = useState(0)
  const [renameOpen, setRenameOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const isAdmin = group?.is_admin ?? false
  const isFinished = group?.competition_status === 'finished'

  useDocumentTitle(group ? `${group.name} — ${TAB_LABELS[activeTab]}` : undefined)

  const [joinedGroupName, setJoinedGroupName] = useState(
    () => (location.state as { joinedGroupName?: string } | null)?.joinedGroupName ?? null,
  )

  useEffect(() => {
    if (!joinedGroupName) return
    navigate({ pathname: location.pathname, search: location.search }, { replace: true })
    const timer = setTimeout(() => setJoinedGroupName(null), JOINED_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [joinedGroupName])

  function openRename() {
    if (!group) return
    trackEvent('click_group_detail_menu_editar_nome')
    setRenameOpen(true)
  }

  async function handlePointsClassifiedChanged() {
    const response = await apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}`))
    const refreshed = response.ok ? parseGroupDetail(await response.json()) : null
    if (!refreshed) throw new Error('Pontuação salva. Recarregue a página para atualizar o grupo.')
    setGroup(refreshed)
    setSettingsVersion((value) => value + 1)
  }

  function handleGroupRenamed(name: string) {
    setGroup((prev) => (prev ? { ...prev, name } : prev))
  }

  function handleJoinRequestsEnabledChanged(enabled: boolean) {
    setGroup((prev) => (prev ? { ...prev, join_requests_enabled: enabled } : prev))
  }

  function handleJoinRequestDecided(action: 'approve' | 'reject') {
    setGroup((prev) =>
      prev
        ? {
            ...prev,
            pending_join_request_count: Math.max(0, (prev.pending_join_request_count ?? 1) - 1),
            ...(action === 'approve'
              ? { member_count: (prev.member_count ?? 0) + 1 }
              : {}),
          }
        : prev,
    )
  }

  function handleMemberRemoved() {
    setGroup((prev) =>
      prev ? { ...prev, member_count: Math.max(0, (prev.member_count ?? 1) - 1) } : prev,
    )
  }

  function handleRotateInvite() {
    rotateInvite((inviteCode) =>
      setGroup((prev) => (prev ? { ...prev, invite_code: inviteCode } : prev)),
    )
  }

  const modals = (
    <>
      <RenameGroupModal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        groupId={groupId}
        currentName={group?.name ?? ''}
        currentPointsClassified={group?.points_classified ?? 0}
        currentJoinRequestsEnabled={group?.join_requests_enabled ?? true}
        onPointsClassifiedChanged={handlePointsClassifiedChanged}
        onRenamed={handleGroupRenamed}
        onJoinRequestsEnabledChanged={handleJoinRequestsEnabledChanged}
      />
      {group && (
        <GroupRulesModal isOpen={rulesOpen} onClose={() => setRulesOpen(false)} group={group} />
      )}
      {confirmDialog}
    </>
  )

  let content
  if (loading) {
    content = <p className={styles.loadingText}>Carregando grupo...</p>
  } else if (error || !group) {
    content = (
      <>
        <ErrorState message={error ?? 'Grupo não encontrado'} />
        <Link to="/" className={styles.backLink}>
          ← Voltar para Meus grupos
        </Link>
      </>
    )
  } else {
    content = (
      <>
        {joinedGroupName && (
          <p className={styles.joinedNotice} role="status">
            Você entrou em {joinedGroupName}
          </p>
        )}

        <GroupHeader
          group={group}
          isAdmin={isAdmin}
          onOpenRename={openRename}
          onOpenRules={() => setRulesOpen(true)}
          onDeleteGroup={deleteGroup}
          deleting={deleting}
          onLeaveGroup={leaveGroup}
          leaving={leaving}
        />

        {isAdmin && group.invite_code && !isFinished && (
          <GroupInviteSection
            inviteCode={group.invite_code}
            groupName={group.name}
            memberCount={group.member_count}
            rotating={rotatingInvite}
            onRotate={handleRotateInvite}
          />
        )}

        {group.public_id && !isFinished && (isAdmin || group.join_requests_enabled !== false) && (
          <GroupLinkSection publicId={group.public_id} groupName={group.name} />
        )}

        <GroupTabs
          activeTab={activeTab}
          showStandings={showStandings}
          isAdmin={isAdmin}
          pendingJoinRequestCount={group.pending_join_request_count ?? 0}
          tabsOffset={tabsOffset}
          tabHref={tabHref}
          onTabClick={handleTabClick}
        />

        <ErrorBoundary
          resetKey={`${groupId}:${activeTab}`}
          fallback={(reset) => <TabError onRetry={reset} />}
        >
          <GroupTabContent
            key={settingsVersion}
            activeTab={activeTab}
            groupId={groupId}
            group={group}
            showStandings={showStandings}
            isAdmin={isAdmin}
            userId={user.id}
            onOpenRules={() => setRulesOpen(true)}
            requestedRound={requestedRound}
            onRequestedRoundApplied={clearRequestedRound}
            onMemberRemoved={handleMemberRemoved}
            onJoinRequestDecided={handleJoinRequestDecided}
          />
        </ErrorBoundary>
      </>
    )
  }

  return (
    <GroupPageFrame user={user} onLogout={onLogout} modals={modals}>
      {content}
    </GroupPageFrame>
  )
}
