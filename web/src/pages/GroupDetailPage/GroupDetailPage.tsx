import { useEffect, useState, type CSSProperties } from 'react'
import {
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from 'react-router-dom'
import { config } from '../../config'
import { useConfirm } from '../../components/ConfirmModal'
import CreateGroupModal from '../../components/CreateGroupModal'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import GroupPicksTab from '../../components/GroupPicksTab'
import GroupHeader from './GroupHeader'
import GroupInviteSection from './GroupInviteSection'
import RenameGroupModal from './RenameGroupModal'
import LeaderboardTab from '../../components/LeaderboardTab'
import MembersTab from '../../components/MembersTab'
import PredictionsTab from '../../components/PredictionsTab'
import StandingsTab, { type CompetitionType } from '../../components/StandingsTab'
import ErrorState from '../../components/ErrorState'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { trackEvent } from '../../analytics/ga'
import styles from './GroupDetailPage.module.css'

interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
  feature_flags?: {
    create_group?: boolean
  }
}

interface GroupDetail {
  id: string
  name: string
  competition_id: string
  competition_name: string | null
  competition_type: CompetitionType | null
  is_admin: boolean
  invite_code: string
  created_at: string
  points_exact: number
  points_winner: number
  predictions_visibility: string
  member_count: number
  user_position: number
  user_points: number
  exact_hits: number
}

const TABS = [
  'predictions',
  'standings',
  'group-picks',
  'leaderboard',
  'members',
] as const
type Tab = (typeof TABS)[number]
const DEFAULT_TAB: Tab = 'predictions'

const TAB_LABELS: Record<Tab, string> = {
  predictions: 'Palpitar',
  standings: 'Tabela',
  'group-picks': 'Grupo',
  leaderboard: 'Ranking',
  members: 'Membros',
}

function parseTab(value: string | null): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : DEFAULT_TAB
}

interface GroupDetailPageProps {
  user: User
  onLogout: () => void
}

export default function GroupDetailPage({
  user,
  onLogout,
}: GroupDetailPageProps) {
  const navigate = useNavigate()
  const { groupId } = useParams<{ groupId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tabsOffset, setTabsOffset] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const rawTab = parseTab(searchParams.get('tab'))
  // Tabela do campeonato só em pontos corridos (competitions.type = 'league');
  // em copas a URL ?tab=standings cai no tab default em vez de painel vazio.
  const showStandings = group?.competition_type === 'league'
  const activeTab = rawTab === 'standings' && group !== null && !showStandings ? DEFAULT_TAB : rawTab

  useDocumentTitle(group ? `${group.name} — ${TAB_LABELS[activeTab]}` : undefined)

  function setActiveTab(tab: Tab) {
    trackEvent('click_group_detail_tab', { tab })
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (tab === DEFAULT_TAB) {
          next.delete('tab')
        } else {
          next.set('tab', tab)
        }
        return next
      },
      { replace: true },
    )
  }

  function tabHref(tab: Tab): string {
    const params = new URLSearchParams(searchParams)
    if (tab === DEFAULT_TAB) {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const qs = params.toString()
    return qs ? `?${qs}` : '.'
  }

  function handleTabClick(e: React.MouseEvent<HTMLAnchorElement>, tab: Tab) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      setActiveTab(tab)
    }
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const isAdmin = group?.is_admin ?? false

  useEffect(() => {
    if (!groupId) return
    setLoading(true)
    setError(null)
    apiFetch(`${config.apiUrl}/groups/${groupId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Grupo não encontrado')
        return r.json() as Promise<{ group: GroupDetail }>
      })
      .then((data) => setGroup(data.group))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId])

  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return

    const updateOffset = () => setTabsOffset(header.clientHeight)

    updateOffset()

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateOffset)

    if (observer) {
      observer.observe(header)
    } else {
      window.addEventListener('resize', updateOffset)
    }

    return () => {
      observer?.disconnect()
      if (!observer) {
        window.removeEventListener('resize', updateOffset)
      }
    }
  }, [])

  if (!groupId) return <Navigate to="/" replace />

  function handleGroupCreated(nextGroup: { id: string }) {
    invalidateApiCache('groups:')
    navigate(`/grupos/${nextGroup.id}`)
  }

  function handleGroupJoined(nextGroup: { id: string }) {
    invalidateApiCache('groups:')
    navigate(`/grupos/${nextGroup.id}`)
  }

  async function leaveGroup() {
    if (!groupId) return
    trackEvent('click_group_detail_menu_sair')

    const ok = await confirm({
      title: 'Sair do grupo',
      message: 'Tem certeza que deseja sair deste grupo?',
      confirmLabel: 'Sair',
      danger: true,
    })
    if (!ok) return

    setLeaving(true)

    try {
      const res = await apiFetch(`${config.apiUrl}/groups/${groupId}/members/${user.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao sair do grupo')
      }

      invalidateApiCache('groups:')
      navigate('/', { replace: true })
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Erro ao sair do grupo')
    } finally {
      setLeaving(false)
    }
  }

  function openRename() {
    if (!group) return
    trackEvent('click_group_detail_menu_editar_nome')
    setRenameOpen(true)
  }

  async function deleteGroup() {
    if (!groupId) return
    trackEvent('click_group_detail_menu_excluir')

    const ok = await confirm({
      title: 'Excluir grupo',
      message:
        'Tem certeza que deseja excluir este grupo? Ele deixará de aparecer para todos os membros.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return

    setDeleting(true)

    try {
      const res = await apiFetch(`${config.apiUrl}/groups/${groupId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao excluir grupo')
      }

      invalidateApiCache('groups:')
      navigate('/', { replace: true, state: { refreshGroups: true } })
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir grupo')
    } finally {
      setDeleting(false)
    }
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
        onRenamed={(name) =>
          setGroup((prev) => (prev ? { ...prev, name } : prev))
        }
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
        <div
          className={styles.tabs}
          style={{ '--tabs-offset': `${tabsOffset}px` } as CSSProperties}
          data-testid="group-tabs"
        >
          <a
            href={tabHref('predictions')}
            className={`${styles.tab} ${activeTab === 'predictions' ? styles.tabActive : ''}`}
            onClick={(e) => handleTabClick(e, 'predictions')}
          >
            Palpitar
          </a>
          {showStandings && (
            <a
              href={tabHref('standings')}
              className={`${styles.tab} ${activeTab === 'standings' ? styles.tabActive : ''}`}
              onClick={(e) => handleTabClick(e, 'standings')}
            >
              Tabela
            </a>
          )}
          <a
            href={tabHref('group-picks')}
            className={`${styles.tab} ${activeTab === 'group-picks' ? styles.tabActive : ''}`}
            onClick={(e) => handleTabClick(e, 'group-picks')}
          >
            Grupo
          </a>
          <a
            href={tabHref('leaderboard')}
            className={`${styles.tab} ${activeTab === 'leaderboard' ? styles.tabActive : ''}`}
            onClick={(e) => handleTabClick(e, 'leaderboard')}
          >
            Ranking
          </a>
          {isAdmin && (
            <a
              href={tabHref('members')}
              className={`${styles.tab} ${activeTab === 'members' ? styles.tabActive : ''}`}
              onClick={(e) => handleTabClick(e, 'members')}
            >
              Membros
            </a>
          )}
        </div>

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
            <GroupPicksTab
              groupId={groupId}
              competitionId={group.competition_id}
            />
          )}
          {activeTab === 'leaderboard' && (
            <LeaderboardTab groupId={groupId} currentUserId={user.id} />
          )}
          {activeTab === 'members' && isAdmin && (
            <MembersTab groupId={groupId} currentUserId={user.id} />
          )}
        </div>
      </main>
      {modals}
    </>
  )
}
