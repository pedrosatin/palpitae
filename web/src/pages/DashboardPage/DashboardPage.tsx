import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../../components/Button'
import CreateGroupModal from '../../components/CreateGroupModal'
import GroupCard, { type GroupWithStats } from '../../components/GroupCard'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import ErrorState from '../../components/ErrorState'
import { groupsQueryKey } from '../../lib/groupsList'
import { consumeAcceptedInvite } from '../../lib/invite'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { trackEvent } from '../../analytics/ga'
import { deadlineBanner, sortByUrgency } from '../../lib/dashboardStatus'
import { withoutParam } from '../../lib/searchParams'
import type { User } from '../../types'
import { useDashboardGroups } from './hooks/useDashboardGroups'
import { useStatusClock } from './hooks/useStatusClock'
import NextDeadlineBanner from './NextDeadlineBanner'
import styles from './DashboardPage.module.css'

interface DashboardPageProps {
  user: User
  onLogout: () => void
}

const COMPETITION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function competitionSlugFromLink(searchParams: URLSearchParams): string | undefined {
  const values = searchParams.getAll('competicao')
  if (values.length !== 1) return undefined
  const [slug] = values
  return slug.length <= 100 && COMPETITION_SLUG.test(slug) ? slug : undefined
}

function EmptyState({
  canCreateGroup,
  onCreateGroup,
  onJoinGroup,
}: {
  canCreateGroup: boolean
  onCreateGroup: () => void
  onJoinGroup: () => void
}) {
  return (
    <div className={styles.emptyState}>
      <h2>Nenhum grupo ainda</h2>
      <p>
        {canCreateGroup
          ? 'Comece a competir criando ou se juntando a um grupo'
          : 'Comece a competir entrando em um grupo com convite'}
      </p>
      <div className={styles.ctaButtons}>
        {canCreateGroup && (
          <Button
            variant="primary"
            onClick={() => {
              trackEvent('click_dashboard_criar_grupo_empty')
              onCreateGroup()
            }}
          >
            Criar grupo
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            trackEvent('click_dashboard_entrar_convite_empty')
            onJoinGroup()
          }}
        >
          Entrar com convite
        </Button>
      </div>
    </div>
  )
}

function GroupsGrid({ groups }: { groups: GroupWithStats[] }) {
  const navigate = useNavigate()

  return (
    <div className={styles.groupsGrid}>
      {groups.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          onClick={() => {
            trackEvent('click_dashboard_grupo')
            navigate(`/grupos/${group.id}`)
          }}
        />
      ))}
    </div>
  )
}

function FinishedGroupsSection({ groups }: { groups: GroupWithStats[] }) {
  const [open, setOpen] = useState(true)

  return (
    <section className={styles.groupsContainer}>
      <button
        type="button"
        className={styles.collapseToggle}
        aria-expanded={open}
        onClick={() => {
          trackEvent('click_dashboard_encerrados_toggle', { open: !open })
          setOpen((v) => !v)
        }}
      >
        <span className={styles.collapseChevron} data-open={open || undefined} aria-hidden="true">
          ▾
        </span>
        <span className={styles.sectionTitle} role="heading" aria-level={2}>
          Encerrados
        </span>
        <span className={styles.sectionCount}>{groups.length}</span>
      </button>
      {open && <GroupsGrid groups={groups} />}
    </section>
  )
}

function GroupsList({ groups, nowMs }: { groups: GroupWithStats[]; nowMs: number }) {
  const ongoing = sortByUrgency(groups.filter((g) => g.competition_status !== 'finished'))
  const finished = groups.filter((g) => g.competition_status === 'finished')
  const banner = deadlineBanner(ongoing)
  const bannerNode = banner && <NextDeadlineBanner banner={banner} nowMs={nowMs} />

  if (finished.length === 0) {
    return (
      <>
        {bannerNode}
        <div className={styles.groupsContainer}>
          <h2 className={styles.sectionTitle}>Seus grupos</h2>
          <GroupsGrid groups={ongoing} />
        </div>
      </>
    )
  }

  return (
    <>
      {bannerNode}
      <div className={styles.sections}>
        {ongoing.length > 0 && (
          <section className={styles.groupsContainer}>
            <h2 className={styles.sectionTitle}>Em andamento</h2>
            <GroupsGrid groups={ongoing} />
          </section>
        )}
        <FinishedGroupsSection groups={finished} />
      </div>
    </>
  )
}

function DashboardContent({
  loading,
  error,
  groups,
  nowMs,
  canCreateGroup,
  onRetry,
  onCreateGroup,
  onJoinGroup,
}: {
  loading: boolean
  error: string | null
  groups: GroupWithStats[]
  nowMs: number
  canCreateGroup: boolean
  onRetry: () => void
  onCreateGroup: () => void
  onJoinGroup: () => void
}) {
  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <p>Carregando...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.content}>
        <ErrorState className={styles.loadError}>
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        </ErrorState>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className={styles.content}>
        <EmptyState
          canCreateGroup={canCreateGroup}
          onCreateGroup={onCreateGroup}
          onJoinGroup={onJoinGroup}
        />
      </div>
    )
  }

  return (
    <div className={styles.content}>
      <GroupsList groups={groups} nowMs={nowMs} />
    </div>
  )
}

export default function DashboardPage({ user, onLogout }: DashboardPageProps) {
  useDocumentTitle('Meus grupos')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const pendingInvite = searchParams.get('convite') ?? undefined
  const normalizedPendingInvite = pendingInvite?.trim().toUpperCase()
  const canCreateGroup = user.feature_flags?.create_group ?? false

  const {
    groups,
    loading,
    error,
    joinOpen,
    setJoinOpen,
    matchedInviteGroupId,
    fetchGroups,
    refreshGroups,
  } = useDashboardGroups({
    userId: user.id,
    normalizedPendingInvite,
  })
  const nowMs = useStatusClock(groups, refreshGroups)

  const [competitionFromLink] = useState(() =>
    canCreateGroup && !pendingInvite ? competitionSlugFromLink(searchParams) : undefined,
  )
  const [createOpen, setCreateOpen] = useState(competitionFromLink !== undefined)
  const [createCompetitionSlug, setCreateCompetitionSlug] = useState(competitionFromLink)

  function closeCreateGroup() {
    setCreateOpen(false)
    setCreateCompetitionSlug(undefined)
  }

  useEffect(() => {
    if (!competitionFromLink || !searchParams.has('competicao')) return
    setSearchParams((prev) => withoutParam(prev, 'competicao'), { replace: true })
  }, [competitionFromLink, searchParams, setSearchParams])

  const [autoJoin, setAutoJoin] = useState(
    () => !!normalizedPendingInvite && consumeAcceptedInvite(normalizedPendingInvite),
  )

  function handleGroupCreated() {
    fetchGroups(true)
  }

  const openGroupFromInvite = useCallback(
    (groupId: string, state?: { joinedGroupName: string }) => {
      navigate(`/grupos/${groupId}`, { replace: Boolean(pendingInvite), state })
    },
    [navigate, pendingInvite],
  )

  function closeJoinGroup() {
    setJoinOpen(false)
    setAutoJoin(false)
    if (!searchParams.has('convite')) return
    setSearchParams((prev) => withoutParam(prev, 'convite'), { replace: true })
  }

  function handleGroupJoined(group: { id: string; name: string }) {
    void queryClient.invalidateQueries({ queryKey: groupsQueryKey, refetchType: 'none' })
    openGroupFromInvite(group.id, { joinedGroupName: group.name })
  }

  useEffect(() => {
    if (matchedInviteGroupId) openGroupFromInvite(matchedInviteGroupId)
  }, [matchedInviteGroupId, openGroupFromInvite])

  return (
    <>
      <Header
        user={user}
        onCreateGroup={() => setCreateOpen(true)}
        onJoinGroup={() => setJoinOpen(true)}
        onLogout={onLogout}
      />

      <main className={styles.root}>
        <DashboardContent
          loading={loading || Boolean(matchedInviteGroupId)}
          error={error}
          groups={groups}
          nowMs={nowMs}
          canCreateGroup={canCreateGroup}
          onRetry={() => fetchGroups(true)}
          onCreateGroup={() => setCreateOpen(true)}
          onJoinGroup={() => setJoinOpen(true)}
        />
      </main>

      <CreateGroupModal
        isOpen={createOpen}
        onClose={closeCreateGroup}
        onCreated={handleGroupCreated}
        preferredCompetitionSlug={createCompetitionSlug}
      />

      <JoinGroupModal
        key={pendingInvite ?? ''}
        isOpen={joinOpen}
        onClose={closeJoinGroup}
        onJoined={handleGroupJoined}
        initialCode={pendingInvite}
        autoSubmit={autoJoin && !!pendingInvite}
      />
    </>
  )
}
