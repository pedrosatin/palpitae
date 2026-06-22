import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from 'react-router-dom'
import { config } from '../../config'
import { useConfirm } from '../../components/ConfirmModal'
import Button from '../../components/Button'
import CreateGroupModal from '../../components/CreateGroupModal'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import Modal from '../../components/Modal'
import GroupPicksTab from '../../components/GroupPicksTab'
import LeaderboardTab from '../../components/LeaderboardTab'
import MembersTab from '../../components/MembersTab'
import PredictionsTab from '../../components/PredictionsTab'
import StandingsTab from '../../components/StandingsTab'
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
  'standings',
  'group-picks',
  'leaderboard',
  'members',
] as const
type Tab = (typeof TABS)[number]
const DEFAULT_TAB: Tab = 'predictions'

const TAB_LABELS: Record<Tab, string> = {
  predictions: 'Palpites',
  standings: 'Tabela',
  'group-picks': 'Palpites do grupo',
  leaderboard: 'Classificação',
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  const menuRef = useRef<HTMLDivElement>(null)
  const activeTab = parseTab(searchParams.get('tab'))

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

  useEffect(() => {
    if (!menuOpen) return

    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)

    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuOpen])

  if (!groupId) return <Navigate to="/" replace />

  function getShareLink() {
    return `${window.location.origin}?convite=${group!.invite_code}`
  }

  async function copyCode() {
    await navigator.clipboard.writeText(group!.invite_code)
    trackEvent('click_group_detail_copiar_codigo')
    setCopied('code')
    setTimeout(() => setCopied(null), 2000)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(getShareLink())
    trackEvent('click_group_detail_copiar_link')
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
      const res = await fetch(`${config.apiUrl}/groups/${groupId}/members/${user.id}`, {
        method: 'DELETE',
        credentials: 'include',
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
    setMenuOpen(false)
    setRenameValue(group.name)
    setRenameError(null)
    setRenameOpen(true)
  }

  async function submitRename(event: React.FormEvent) {
    event.preventDefault()
    if (!groupId) return

    const name = renameValue.trim()
    if (name.length < 2 || name.length > 50) {
      setRenameError('Nome deve ter entre 2 e 50 caracteres')
      return
    }

    setRenaming(true)
    setRenameError(null)

    try {
      const res = await fetch(`${config.apiUrl}/groups/${groupId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao renomear grupo')
      }

      trackEvent('submit_renomear_grupo')
      setGroup((prev) => (prev ? { ...prev, name } : prev))
      invalidateApiCache('groups:')
      setRenameOpen(false)
    } catch (e: unknown) {
      setRenameError(e instanceof Error ? e.message : 'Erro ao renomear grupo')
    } finally {
      setRenaming(false)
    }
  }

  async function deleteGroup() {
    if (!groupId) return
    trackEvent('click_group_detail_menu_excluir')
    setMenuOpen(false)

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
      const res = await fetch(`${config.apiUrl}/groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao excluir grupo')
      }

      invalidateApiCache('groups:')
      navigate('/', { replace: true })
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
      <Modal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Editar nome do grupo"
      >
        <form onSubmit={submitRename} className={styles.renameForm}>
          <input
            className={styles.renameInput}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={50}
            placeholder="Nome do grupo"
            autoFocus
          />
          {renameError && <p className={styles.renameError}>{renameError}</p>}
          <div className={styles.renameActions}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRenameOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={renaming}>
              {renaming ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Modal>
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
            <div className={styles.groupNameRow}>
              <h1 className={styles.groupName}>{group.name}</h1>
              <div className={styles.menuWrap} ref={menuRef}>
                <button
                  className={styles.kebabBtn}
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="Opções do grupo"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div className={styles.menu} role="menu">
                    {isAdmin ? (
                      <>
                        <button
                          className={styles.menuItemNeutral}
                          role="menuitem"
                          onClick={openRename}
                        >
                          Editar nome
                        </button>
                        <button
                          className={styles.menuItem}
                          role="menuitem"
                          onClick={deleteGroup}
                          disabled={deleting}
                        >
                          {deleting ? 'Excluindo...' : 'Excluir grupo'}
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.menuItem}
                        role="menuitem"
                        onClick={leaveGroup}
                        disabled={leaving}
                      >
                        {leaving ? 'Saindo...' : 'Sair do grupo'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className={styles.groupActions}>
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
            Palpites
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'standings' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('standings')}
          >
            Tabela
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
          {activeTab === 'standings' && (
            <StandingsTab competitionId={group.competition_id} />
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
