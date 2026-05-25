import { useEffect, useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { config } from '../config'
import CreateGroupModal from '../components/CreateGroupModal'
import Header from '../components/Header'
import JoinGroupModal from '../components/JoinGroupModal'
import PredictionsTab from '../components/PredictionsTab'
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
  admin_id: string
  invite_code: string
  created_at: string
  member_count: number
  user_position: number
  user_points: number
  exact_hits: number
}

type Tab = 'predictions' | 'leaderboard'

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
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('predictions')
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const isAdmin = group?.admin_id === user.id

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

  const modals = (
    <>
      <CreateGroupModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(group) => navigate(`/grupos/${group.id}`)}
      />
      <JoinGroupModal
        isOpen={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(group) => navigate(`/grupos/${group.id}`)}
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
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'predictions' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('predictions')}
          >
            Previsões
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'leaderboard' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            Classificação
          </button>
        </div>

        <div className={styles.tabContent}>
          {activeTab === 'predictions' && (
            <PredictionsTab
              groupId={groupId}
              competitionId={group.competition_id}
            />
          )}
          {activeTab === 'leaderboard' && (
            <div className={styles.placeholder}>
              <p>A classificação do grupo aparecerá aqui em breve.</p>
            </div>
          )}
        </div>
      </main>
      {modals}
    </>
  )
}
