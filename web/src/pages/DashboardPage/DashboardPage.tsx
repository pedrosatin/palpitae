import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../../components/Button'
import CreateGroupModal from '../../components/CreateGroupModal'
import GroupCard, { type GroupWithStats } from '../../components/GroupCard'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import ErrorState from '../../components/ErrorState'
import { invalidateApiCache } from '../../lib/api-cache'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { trackEvent } from '../../analytics/ga'
import { deadlineBanner, sortByUrgency } from '../../lib/dashboardStatus'
import { useDashboardGroups } from './hooks/useDashboardGroups'
import NextDeadlineBanner from './NextDeadlineBanner'
import styles from './DashboardPage.module.css'

interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
  feature_flags?: {
    create_group?: boolean
  }
}

interface DashboardPageProps {
  user: User
  onLogout: () => void
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
            trackEvent('click_dashboard_grupo', { group_id: group.id })
            navigate(`/grupos/${group.id}`)
          }}
        />
      ))}
    </div>
  )
}

/**
 * Grupos de campeonatos encerrados. Ficam numa seção própria, abaixo dos ativos,
 * colapsável — o resultado ainda é a parte mais empolgante logo após o fim, então
 * abre por padrão, mas o usuário pode recolher para tirar do caminho.
 */
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

function GroupsList({ groups }: { groups: GroupWithStats[] }) {
  // Os grupos em andamento seguem a ordem de urgência, com o jogo sem palpite que
  // fecha antes no topo. Encerrados mantêm a ordem da API.
  const ongoing = sortByUrgency(groups.filter((g) => g.competition_status !== 'finished'))
  const finished = groups.filter((g) => g.competition_status === 'finished')
  const banner = deadlineBanner(ongoing)
  const bannerNode = banner && <NextDeadlineBanner banner={banner} nowMs={Date.now()} />

  // Sem grupos encerrados: mantém a visão simples de sempre, sem seções extras.
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

export default function DashboardPage({ user, onLogout }: DashboardPageProps) {
  useDocumentTitle('Meus grupos')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pendingInvite = searchParams.get('convite') ?? undefined
  const normalizedPendingInvite = pendingInvite?.trim().toUpperCase()
  const canCreateGroup = user.feature_flags?.create_group ?? false

  const { groups, loading, error, joinOpen, setJoinOpen, matchedInviteGroupId, fetchGroups } =
    useDashboardGroups({
      userId: user.id,
      normalizedPendingInvite,
    })

  const [createOpen, setCreateOpen] = useState(false)

  function handleGroupCreated() {
    fetchGroups(true)
    // Deixamos o modal aberto com a tela de sucesso ("Pronto"). O `CreateGroupModal`
    // cuida do próprio estado de finalização.
  }

  /** Abre o grupo. Com `?convite=` na URL, substitui essa entrada do histórico. */
  const openGroupFromInvite = useCallback(
    (groupId: string) => {
      navigate(`/grupos/${groupId}`, pendingInvite ? { replace: true } : undefined)
    },
    [navigate, pendingInvite],
  )

  function handleGroupJoined(group: { id: string; name: string }) {
    invalidateApiCache('groups:')
    openGroupFromInvite(group.id)
  }

  // Se o convite é de um grupo em que o usuário já está, navega para o grupo em
  // vez de deixar o painel parado com `?convite=` na URL.
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
        {loading || matchedInviteGroupId ? (
          <div className={styles.loadingContainer}>
            <p>Carregando...</p>
          </div>
        ) : (
          <div className={styles.content}>
            {error && <ErrorState message={error} />}

            {groups.length === 0 ? (
              <EmptyState
                canCreateGroup={canCreateGroup}
                onCreateGroup={() => setCreateOpen(true)}
                onJoinGroup={() => setJoinOpen(true)}
              />
            ) : (
              <GroupsList groups={groups} />
            )}
          </div>
        )}
      </main>

      <CreateGroupModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleGroupCreated}
      />

      <JoinGroupModal
        isOpen={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={handleGroupJoined}
        initialCode={pendingInvite}
      />
    </>
  )
}
