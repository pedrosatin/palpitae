import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, Navigate } from 'react-router-dom'
import CreateGroupModal from '../../components/CreateGroupModal'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import GroupRulesModal from '../../components/GroupRulesModal'
import GroupHeader from './GroupHeader'
import GroupInviteSection from './GroupInviteSection'
import RenameGroupModal from './RenameGroupModal'
import ErrorState from '../../components/ErrorState'
import ErrorBoundary, { TabError } from '../../components/ErrorBoundary'
import { apiFetch } from '../../lib/api'
import { buildApiUrl } from '../../config'
import { invalidateApiCache } from '../../lib/api-cache'
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

/** Tempo na tela da confirmação de entrada no grupo. */
const JOINED_NOTICE_MS = 6000

export default function GroupDetailPage({ user, onLogout }: GroupDetailPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { groupId: rawGroupId } = useParams<{ groupId: string }>()
  // Id com formato inválido segue como ausente nos hooks, então nenhuma
  // requisição sai para a API com ele.
  const groupId = isGroupId(rawGroupId) ? rawGroupId : undefined
  const invalidGroupId = rawGroupId !== undefined && groupId === undefined

  const { group, setGroup, loading, error } = useGroupDetail(groupId)
  const {
    activeTab,
    showStandings,
    tabHref,
    handleTabClick,
    requestedRound,
    clearRequestedRound,
  } = useGroupTabs(group)
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
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const isAdmin = group?.is_admin ?? false
  const isFinished = group?.competition_status === 'finished'

  useDocumentTitle(group ? `${group.name} — ${TAB_LABELS[activeTab]}` : undefined)

  const [joinedGroupName, setJoinedGroupName] = useState(
    () => (location.state as { joinedGroupName?: string } | null)?.joinedGroupName ?? null,
  )

  // Tira a confirmação do histórico, para o recarregamento não repetir o aviso.
  useEffect(() => {
    if (!joinedGroupName) return
    navigate({ pathname: location.pathname, search: location.search }, { replace: true })
    const timer = setTimeout(() => setJoinedGroupName(null), JOINED_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [joinedGroupName])

  if (!rawGroupId) return <Navigate to="/" replace />

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

  async function handlePointsClassifiedChanged() {
    if (!groupId) return
    const response = await apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}`))
    const refreshed = response.ok ? parseGroupDetail(await response.json()) : null
    if (!refreshed) throw new Error('Pontuação salva. Recarregue a página para atualizar o grupo.')
    setGroup(refreshed)
    setSettingsVersion((value) => value + 1)
  }

  function openRules() {
    setRulesOpen(true)
  }

  function closeRules() {
    setRulesOpen(false)
  }

  function handleGroupRenamed(name: string) {
    setGroup((prev) => (prev ? { ...prev, name } : prev))
  }

  function handleRotateInvite() {
    rotateInvite((inviteCode) =>
      setGroup((prev) => (prev ? { ...prev, invite_code: inviteCode } : prev)),
    )
  }

  const header = (
    <Header
      user={user}
      onCreateGroup={() => setCreateOpen(true)}
      onJoinGroup={() => setJoinOpen(true)}
      onLogout={onLogout}
    />
  )

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
      {groupId && (
        <RenameGroupModal
          isOpen={renameOpen}
          onClose={() => setRenameOpen(false)}
          groupId={groupId}
          currentName={group?.name ?? ''}
          currentPointsClassified={group?.points_classified ?? 0}
          onPointsClassifiedChanged={handlePointsClassifiedChanged}
          onRenamed={handleGroupRenamed}
        />
      )}
      {group && <GroupRulesModal isOpen={rulesOpen} onClose={closeRules} group={group} />}
      {confirmDialog}
    </>
  )

  let content
  if (invalidGroupId) {
    content = (
      <>
        <ErrorState message="Grupo não encontrado" />
        <Link to="/" className={styles.backLink}>
          ← Voltar para Meus grupos
        </Link>
      </>
    )
  } else if (loading) {
    content = <p className={styles.loadingText}>Carregando grupo...</p>
  } else if (error || !group || !groupId) {
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

        {/* Group header */}
        <GroupHeader
          group={group}
          isAdmin={isAdmin}
          onOpenRename={openRename}
          onOpenRules={openRules}
          onDeleteGroup={deleteGroup}
          deleting={deleting}
          onLeaveGroup={leaveGroup}
          leaving={leaving}
        />

        {/* Convite do admin. Fica escondido quando a competição acabou. */}
        {isAdmin && group.invite_code && !isFinished && (
          <GroupInviteSection
            inviteCode={group.invite_code}
            groupName={group.name}
            memberCount={group.member_count}
            rotating={rotatingInvite}
            onRotate={handleRotateInvite}
          />
        )}

        {/* Tabs */}
        <GroupTabs
          activeTab={activeTab}
          showStandings={showStandings}
          isAdmin={isAdmin}
          tabsOffset={tabsOffset}
          tabHref={tabHref}
          onTabClick={handleTabClick}
        />

        {/* Aba que quebra no render mostra o erro no lugar dela; trocar de aba sai dele. */}
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
            onOpenRules={openRules}
            requestedRound={requestedRound}
            onRequestedRoundApplied={clearRequestedRound}
          />
        </ErrorBoundary>
      </>
    )
  }

  return (
    <>
      {header}
      <main className={styles.root}>{content}</main>
      {modals}
    </>
  )
}
