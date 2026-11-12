import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../../components/Button'
import CreateGroupModal from '../../components/CreateGroupModal'
import GroupCard, { type GroupWithStats } from '../../components/GroupCard'
import Header from '../../components/Header'
import JoinGroupModal from '../../components/JoinGroupModal'
import ErrorState from '../../components/ErrorState'
import { invalidateApiCache } from '../../lib/api-cache'
import { consumeAcceptedInvite } from '../../lib/invite'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { trackEvent } from '../../analytics/ga'
import { deadlineBanner, sortByUrgency } from '../../lib/dashboardStatus'
import { useDashboardGroups } from './hooks/useDashboardGroups'
import { useStatusClock } from './hooks/useStatusClock'
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

const COMPETITION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Slug pedido em `?competicao=` pelo CTA de um guia. Vale só um parâmetro, com
 * até 100 caracteres, em minúsculas, números e hífens. Fora disso, o pedido é
 * ignorado.
 */
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

function GroupsList({ groups, nowMs }: { groups: GroupWithStats[]; nowMs: number }) {
  // Os grupos em andamento seguem a ordem de urgência, com o jogo sem palpite que
  // fecha antes no topo. Encerrados mantêm a ordem da API.
  const ongoing = sortByUrgency(groups.filter((g) => g.competition_status !== 'finished'))
  const finished = groups.filter((g) => g.competition_status === 'finished')
  const banner = deadlineBanner(ongoing)
  const bannerNode = banner && <NextDeadlineBanner banner={banner} nowMs={nowMs} />

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
  // Pendências, prazo e jogo ao vivo mudam com o relógio, sem nova edição.
  const nowMs = useStatusClock(groups, refreshGroups)

  // O CTA do guia pede uma competição em `?competicao=`. Na montagem, o painel
  // abre a criação com ela escolhida. Convite na URL tem prioridade.
  const [competitionFromLink] = useState(() =>
    canCreateGroup && !pendingInvite ? competitionSlugFromLink(searchParams) : undefined,
  )
  const [createOpen, setCreateOpen] = useState(competitionFromLink !== undefined)
  // A preferência vale só para essa abertura. Fechar o modal a descarta.
  const [createCompetitionSlug, setCreateCompetitionSlug] = useState(competitionFromLink)

  function closeCreateGroup() {
    setCreateOpen(false)
    setCreateCompetitionSlug(undefined)
  }

  // Tira só o `competicao` da entrada atual do histórico, para recarregar não
  // reabrir o modal. A volta até `/entrar` fica a cargo do redirect do App.
  useEffect(() => {
    if (!competitionFromLink || !searchParams.has('competicao')) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('competicao')
        return next
      },
      { replace: true },
    )
  }, [competitionFromLink, searchParams, setSearchParams])

  // Só quem tocou em "Entrar com Google e participar" nesta aba entra sem
  // confirmar. Um link `?convite=` aberto sozinho continua pedindo o toque.
  // Fechar o modal descarta essa entrada: seguir o mesmo link de novo pede o toque.
  const [autoJoin, setAutoJoin] = useState(
    () => !!normalizedPendingInvite && consumeAcceptedInvite(normalizedPendingInvite),
  )

  function handleGroupCreated() {
    fetchGroups(true)
    // Deixamos o modal aberto com a tela de sucesso ("Pronto"). O `CreateGroupModal`
    // cuida do próprio estado de finalização.
  }

  /** Abre o grupo. Com `?convite=` na URL, substitui essa entrada do histórico. */
  const openGroupFromInvite = useCallback(
    (groupId: string, state?: { joinedGroupName: string }) => {
      navigate(`/grupos/${groupId}`, { replace: Boolean(pendingInvite), state })
    },
    [navigate, pendingInvite],
  )

  // Fechar o modal do convite consome o `?convite=`: recarregar a lista ou a página
  // não o reabre. Um novo link de convite volta a abrir o modal.
  function closeJoinGroup() {
    setJoinOpen(false)
    setAutoJoin(false)
    if (!searchParams.has('convite')) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('convite')
        return next
      },
      { replace: true },
    )
  }

  function handleGroupJoined(group: { id: string; name: string }) {
    invalidateApiCache('groups:')
    openGroupFromInvite(group.id, { joinedGroupName: group.name })
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
            {error ? (
              <ErrorState className={styles.loadError}>
                <p>{error}</p>
                <Button variant="secondary" size="sm" onClick={() => fetchGroups(true)}>
                  Tentar novamente
                </Button>
              </ErrorState>
            ) : groups.length === 0 ? (
              <EmptyState
                canCreateGroup={canCreateGroup}
                onCreateGroup={() => setCreateOpen(true)}
                onJoinGroup={() => setJoinOpen(true)}
              />
            ) : (
              <GroupsList groups={groups} nowMs={nowMs} />
            )}
          </div>
        )}
      </main>

      <CreateGroupModal
        isOpen={createOpen}
        onClose={closeCreateGroup}
        onCreated={handleGroupCreated}
        preferredCompetitionSlug={createCompetitionSlug}
      />

      {/* A chave recria o modal quando o convite sai da URL: o código dispensado não
          fica no campo nem é reenviado ao abrir a entrada pela tela. */}
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
