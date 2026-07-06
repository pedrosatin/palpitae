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
import shared from '../../components/modal-shared.module.css'

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

function AdminInviteSection({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  function getShareLink() {
    return `${window.location.origin}?convite=${inviteCode}`
  }

  async function copyCode() {
    await navigator.clipboard.writeText(inviteCode)
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

  return (
    <div className={styles.inviteSection}>
      <h2 className={styles.inviteTitle}>Convidar membros</h2>
      <div className={styles.inviteRow}>
        <div className={styles.codeBox}>
          <span className={styles.codeLabel}>Código</span>
          <div className={styles.codeValueRow}>
            <span className={styles.code}>{inviteCode}</span>
            <Button variant="outline" size="sm" onClick={copyCode}>
              {copied === 'code' ? 'Copiado!' : 'Copiar'}
            </Button>
          </div>
        </div>
        <div className={styles.linkBox}>
          <span className={styles.codeLabel}>Link direto</span>
          <div className={styles.linkValueRow}>
            <span className={shared.linkText}>{getShareLink()}</span>
            <Button variant="outline" size="sm" onClick={copyLink}>
              {copied === 'link' ? 'Copiado!' : 'Copiar link'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RenameGroupModal({
  isOpen,
  onClose,
  groupId,
  initialName,
  onRenamed,
}: {
  isOpen: boolean
  onClose: () => void
  groupId: string
  initialName: string
  onRenamed: (newName: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setName(initialName)
      setError(null)
    }
  }, [isOpen, initialName])

  async function submitRename(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 50) {
      setError('Nome deve ter entre 2 e 50 caracteres')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`${config.apiUrl}/groups/${groupId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao renomear grupo')
      }

      trackEvent('submit_renomear_grupo')
      onRenamed(trimmed)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao renomear grupo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar nome do grupo">
      <form onSubmit={submitRename} className={styles.renameForm}>
        <input
          className={styles.renameInput}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="Nome do grupo"
          autoFocus
        />
        {error && <p className={styles.renameError}>{error}</p>}
        <div className={styles.renameActions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function useGroupData(groupId: string | undefined) {
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return { group, setGroup, loading, error }
}

function useTabsOffset() {
  const [tabsOffset, setTabsOffset] = useState(0)

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

  return tabsOffset
}

function useGroupActions(groupId: string | undefined, userId: string, onCloseMenu: () => void) {
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()
  const { confirm, confirmDialog } = useConfirm()

  async function leaveGroup() {
    if (!groupId) return
    trackEvent('click_group_detail_menu_sair')
    onCloseMenu()

    const ok = await confirm({
      title: 'Sair do grupo',
      message: 'Tem certeza que deseja sair deste grupo?',
      confirmLabel: 'Sair',
      danger: true,
    })
    if (!ok) return

    setLeaving(true)

    try {
      const res = await fetch(`${config.apiUrl}/groups/${groupId}/members/${userId}`, {
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

  async function deleteGroup() {
    if (!groupId) return
    trackEvent('click_group_detail_menu_excluir')
    onCloseMenu()

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
      navigate('/', { replace: true, state: { refreshGroups: true } })
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir grupo')
    } finally {
      setDeleting(false)
    }
  }

  return { leaveGroup, deleteGroup, leaving, deleting, confirmDialog }
}

function GroupHeader({
  group,
  isAdmin,
  menuRef,
  menuOpen,
  setMenuOpen,
  openRename,
  deleteGroup,
  deleting,
  leaveGroup,
  leaving,
}: {
  group: GroupDetail
  isAdmin: boolean
  menuRef: React.RefObject<HTMLDivElement>
  menuOpen: boolean
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  openRename: () => void
  deleteGroup: () => void
  deleting: boolean
  leaveGroup: () => void
  leaving: boolean
}) {
  return (
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
  )
}

function GroupTabs({
  tabsOffset,
  activeTab,
  isAdmin,
  handleTabClick,
  tabHref,
}: {
  tabsOffset: number
  activeTab: Tab
  isAdmin: boolean
  handleTabClick: (e: React.MouseEvent<HTMLAnchorElement>, tab: Tab) => void
  tabHref: (tab: Tab) => string
}) {
  return (
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
      <a
        href={tabHref('standings')}
        className={`${styles.tab} ${activeTab === 'standings' ? styles.tabActive : ''}`}
        onClick={(e) => handleTabClick(e, 'standings')}
      >
        Tabela
      </a>
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
  )
}

export default function GroupDetailPage({
  user,
  onLogout,
}: GroupDetailPageProps) {
  const navigate = useNavigate()
  const { groupId } = useParams<{ groupId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { group, setGroup, loading, error } = useGroupData(groupId)
  const tabsOffset = useTabsOffset()
  const [menuOpen, setMenuOpen] = useState(false)
  const { leaveGroup, deleteGroup, leaving, deleting, confirmDialog } = useGroupActions(
    groupId,
    user.id,
    () => setMenuOpen(false)
  )
  const [renameOpen, setRenameOpen] = useState(false)
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
    setMenuOpen(false)
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
      {group && (
        <RenameGroupModal
          isOpen={renameOpen}
          onClose={() => setRenameOpen(false)}
          groupId={groupId!}
          initialName={group.name}
          onRenamed={(newName) => {
            setGroup((prev) => (prev ? { ...prev, name: newName } : prev))
            invalidateApiCache('groups:')
            setRenameOpen(false)
          }}
        />
      )}
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
        <GroupHeader
          group={group}
          isAdmin={isAdmin}
          menuRef={menuRef}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          openRename={openRename}
          deleteGroup={deleteGroup}
          deleting={deleting}
          leaveGroup={leaveGroup}
          leaving={leaving}
        />

        {/* Admin: invite section */}
        {isAdmin && (
          <AdminInviteSection inviteCode={group.invite_code} />
        )}

        <GroupTabs
          tabsOffset={tabsOffset}
          activeTab={activeTab}
          isAdmin={isAdmin}
          handleTabClick={handleTabClick}
          tabHref={tabHref}
        />

        <div className={styles.tabContent}>
          {activeTab === 'predictions' && (
            <PredictionsTab
              groupId={groupId}
              competitionId={group.competition_id}
              pointsExact={group.points_exact}
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
