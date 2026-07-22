import { useState } from 'react'
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
import { useDashboardGroups } from './hooks/useDashboardGroups'
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
  const ongoing = groups.filter((g) => g.competition_status !== 'finished')
  const finished = groups.filter((g) => g.competition_status === 'finished')

  // Sem grupos encerrados: mantém a visão simples de sempre, sem seções extras.
  if (finished.length === 0) {
    return (
      <div className={styles.groupsContainer}>
        <h2 className={styles.sectionTitle}>Seus grupos</h2>
        <GroupsGrid groups={ongoing} />
      </div>
    )
  }

  return (
    <div className={styles.sections}>
      {ongoing.length > 0 && (
        <section className={styles.groupsContainer}>
          <h2 className={styles.sectionTitle}>Em andamento</h2>
          <GroupsGrid groups={ongoing} />
        </section>
      )}
      <FinishedGroupsSection groups={finished} />
    </div>
  )
}

export default function DashboardPage({ user, onLogout }: DashboardPageProps) {
  useDocumentTitle('Meus grupos')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pendingInvite = searchParams.get('convite') ?? undefined
  const normalizedPendingInvite = pendingInvite?.trim().toUpperCase()
  const canCreateGroup = user.feature_flags?.create_group ?? false

  const { groups, loading, error, joinOpen, setJoinOpen, fetchGroups } = useDashboardGroups({
    normalizedPendingInvite,
  })

  const [createOpen, setCreateOpen] = useState(false)

  function handleGroupCreated() {
    fetchGroups(true)
    // Deixamos o modal aberto com a tela de sucesso ("Pronto"). O `CreateGroupModal`
    // cuida do próprio estado de finalização.
  }

  function handleGroupJoined(group: { id: string; name: string }) {
    invalidateApiCache('groups:')
    navigate(`/grupos/${group.id}`, pendingInvite ? { replace: true } : undefined)
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
        {loading ? (
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
