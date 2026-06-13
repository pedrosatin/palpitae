import { useEffect, useState, type CSSProperties } from 'react'
import {
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from 'react-router-dom'
import { config } from '../../config'
import CreateGroupModal from '../../components/CreateGroupModal'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import BracketTab from '../../components/BracketTab/BracketTab'
import GroupPicksTab from '../../components/GroupPicksTab'
import LeaderboardTab from '../../components/LeaderboardTab'
import MembersTab from '../../components/MembersTab'
import PredictionsTab from '../../components/PredictionsTab'
import { invalidateApiCache } from '../../lib/api-cache'
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
  is_admin: boolean
  invite_code: string
  created_at: string
  member_count: number
  user_position: number
  user_points: number
  exact_hits: number
}

const TABS = [
  'predictions',
  'group-picks',
  'leaderboard',
  'bracket',
  'members',
] as const
type Tab = (typeof TABS)[number]
const DEFAULT_TAB: Tab = 'predictions'

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
  const activeTab = parseTab(searchParams.get('tab'))

  function setActiveTab(tab: Tab) {
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
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const isAdmin = group?.is_admin ?? false

  useEffect(() => {
    if (!groupId) return
    setLoading(true)
    setError(null)
    fetch(`${config.apiUrl}/groups/${groupId}`, { credentials: 'include' })
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

  function getShareLink() {
    return `${window.location.origin}?convite=${group!.invite_code}`
  }

  async function copyCode() {
    await navigator.clipboard.writeText(group!.invite_code)
    setCopied('code')
    setTimeout(() => setCopied(null), 2000)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(getShareLink())
    setCopied('link')
    setTimeout(() => setCopied(null), 2000)
  }

  function handleGroupCreated(nextGroup: { id: string }) {
    invalidateApiCache('groups:')
    navigate(`/grupos/${nextGroup.id}`)
  }

  function handleGroupJoined(nextGroup: { id: string }) {
    invalidateApiCache('groups:')
    navigate(`/grupos/${nextGroup.id}`)
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
          <div className={styles.errorBox}>
            {error ?? 'Grupo não encontrado'}
          </div>
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
        <div className={styles.groupHeader}>
          <div className={styles.groupMeta}>
            <span className={styles.competition}>
              {group.competition_name ?? group.competition_id}
            </span>
            <h1 className={styles.groupName}>{group.name}</h1>
          </div>
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{group.member_count}</span>
              <span className={styles.statLabel}>membros</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>#{group.user_position}</span>
              <span className={styles.statLabel}>sua posição</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{group.user_points}</span>
              <span className={styles.statLabel}>pontos</span>
            </div>
          </div>
        </div>

        {/* Admin: invite section */}
        {isAdmin && (
          <div className={styles.inviteSection}>
            <h2 className={styles.inviteTitle}>Convidar membros</h2>
            <div className={styles.inviteRow}>
              <div className={styles.codeBox}>
                <span className={styles.codeLabel}>Código</span>
                <div className={styles.codeValueRow}>
                  <span className={styles.code}>{group.invite_code}</span>
                  <button className={styles.copyBtn} onClick={copyCode}>
                    {copied === 'code' ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
              </div>
              <div className={styles.linkBox}>
                <span className={styles.codeLabel}>Link direto</span>
                <div className={styles.linkValueRow}>
                  <span className={styles.linkText}>{getShareLink()}</span>
                  <button className={styles.copyBtn} onClick={copyLink}>
                    {copied === 'link' ? 'Copiado!' : 'Copiar link'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div
          className={styles.tabs}
          style={{ '--tabs-offset': `${tabsOffset}px` } as CSSProperties}
          data-testid="group-tabs"
        >
          <button
            className={`${styles.tab} ${activeTab === 'predictions' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('predictions')}
          >
            Previsões
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'group-picks' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('group-picks')}
          >
            Palpites do grupo
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'leaderboard' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            Classificação
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'bracket' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('bracket')}
          >
            Chaveamento
          </button>
          {isAdmin && (
            <button
              className={`${styles.tab} ${activeTab === 'members' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('members')}
            >
              Membros
            </button>
          )}
        </div>

        <div className={styles.tabContent}>
          {activeTab === 'predictions' && (
            <PredictionsTab
              groupId={groupId}
              competitionId={group.competition_id}
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
          {activeTab === 'bracket' && (
            <BracketTab
              groupId={groupId}
              competitionId={group.competition_id}
            />
          )}
        </div>
      </main>
      {modals}
    </>
  )
}
