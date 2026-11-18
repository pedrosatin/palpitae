import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { trackJoinRequest } from '../../analytics/funnel'
import { trackEvent } from '../../analytics/ga'
import Button from '../../components/Button'
import Card from '../../components/Card'
import GoogleLoginButton from '../../components/GoogleLoginButton'
import { buildApiUrl } from '../../config'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { apiFetch, readApiError } from '../../lib/api'
import { normalizePublicId } from '../../lib/groupLink'
import type { User } from '../../types'
import styles from '../InvitePage/InvitePage.module.css'

type Preview = {
  groupName: string
  competitionName: string | null
  memberCount: number
  joinRequestsEnabled: boolean
}

type State =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'unavailable' }
  | { status: 'ready'; preview: Preview }

async function lookupGroup(publicId: string): Promise<State> {
  try {
    const res = await fetch(buildApiUrl(`/public/groups/${encodeURIComponent(publicId)}`))
    if (res.status === 404) return { status: 'invalid' }
    if (!res.ok) return { status: 'unavailable' }
    const body = (await res.json()) as {
      group?: {
        group_name?: string
        competition_name?: string | null
        member_count?: number
        join_requests_enabled?: boolean
      }
    }
    const g = body.group
    if (!g?.group_name || typeof g.member_count !== 'number') return { status: 'unavailable' }
    return {
      status: 'ready',
      preview: {
        groupName: g.group_name,
        competitionName: g.competition_name ?? null,
        memberCount: g.member_count,
        joinRequestsEnabled: Boolean(g.join_requests_enabled),
      },
    }
  } catch {
    return { status: 'unavailable' }
  }
}

function pageTitle(state: State): string {
  if (state.status === 'ready') return `Entrar em ${state.preview.groupName}`
  if (state.status === 'invalid') return 'Link inválido'
  return 'Pedido de entrada'
}

interface GroupJoinPageProps {
  /** Presente quando a sessão já resolveu como autenticada. */
  user?: User | null
}

/**
 * Página pública do link do grupo (`/grupo/:publicId`). Mostra só nome,
 * campeonato e número de membros. Com conta, o visitante pede entrada.
 */
export default function GroupJoinPage({ user = null }: GroupJoinPageProps) {
  const { publicId: raw } = useParams()
  const publicId = normalizePublicId(raw)
  return <GroupJoinContent key={publicId ?? raw} publicId={publicId} user={user} />
}

function GroupJoinContent({
  publicId,
  user,
}: {
  publicId: string | null
  user: User | null
}) {
  const [state, setState] = useState<State>(publicId ? { status: 'loading' } : { status: 'invalid' })
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useDocumentTitle(pageTitle(state))

  useEffect(() => {
    if (!publicId) return
    let cancelled = false
    void lookupGroup(publicId).then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [publicId])

  async function requestJoin() {
    if (!publicId) return
    trackEvent('click_group_join_pedir')
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await apiFetch(buildApiUrl('/groups/join-requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_id: publicId }),
      })
      if (!res.ok) throw new Error(await readApiError(res, 'Não foi possível pedir entrada'))
      trackJoinRequest()
      setDone(true)
      setMessage('Pedido enviado. O dono do grupo vai analisar.')
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Não foi possível pedir entrada')
    } finally {
      setSubmitting(false)
    }
  }

  if (state.status === 'invalid' || !publicId) {
    return (
      <Shell>
        <div className={styles.heading}>
          <h1 className={styles.title}>Este link não vale mais</h1>
          <p className={styles.notice}>Peça um link novo a quem te convidou.</p>
        </div>
        <Link to="/" className={styles.landingButton}>
          Conhecer o Palpitae
        </Link>
      </Shell>
    )
  }

  const preview = state.status === 'ready' ? state.preview : null
  const canRequest = preview?.joinRequestsEnabled !== false

  return (
    <Shell>
      {state.status === 'loading' && <p className={styles.notice}>Carregando grupo...</p>}
      {state.status === 'unavailable' && (
        <div className={styles.heading}>
          <h1 className={styles.title}>Você recebeu um convite para um bolão</h1>
          <p className={styles.notice}>Os detalhes do grupo não carregaram agora.</p>
        </div>
      )}
      {preview && (
        <>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>Pedido de entrada</p>
            <h1 className={styles.title}>{preview.groupName}</h1>
          </div>
          <dl className={styles.details}>
            {preview.competitionName && (
              <DetailRow label="Campeonato">{preview.competitionName}</DetailRow>
            )}
            <DetailRow label="Participantes">{preview.memberCount}</DetailRow>
          </dl>
        </>
      )}

      <p className={styles.free}>Grátis, sem apostas</p>

      {user ? (
        canRequest && !done ? (
          <Button onClick={requestJoin} disabled={submitting} data-testid="pedir-entrada">
            {submitting ? 'Enviando…' : 'Pedir para participar'}
          </Button>
        ) : null
      ) : (
        canRequest && (
          <GoogleLoginButton
            label="Entrar com Google para pedir"
            redirect={`/grupo/${publicId}`}
          />
        )
      )}

      {!canRequest && preview && (
        <p className={styles.notice}>Este grupo não está aceitando pedidos pelo link.</p>
      )}
      {message && (
        <p className={styles.notice} role="status">
          {message}
        </p>
      )}
      {user && (
        <button type="button" className={styles.landingLink} onClick={() => navigate('/')}>
          Ir para meus grupos
        </button>
      )}
      <Link to="/" className={styles.landingLink}>
        Conhecer o Palpitae
      </Link>
    </Shell>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detailRow}>
      <dt className={styles.detailLabel}>{label}</dt>
      <dd className={styles.detailValue}>{children}</dd>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.root} data-testid="group-join-page">
      <Card className={styles.card}>
        <img src="/logo-text.svg" alt="Palpitae" className={styles.logo} />
        {children}
      </Card>
    </main>
  )
}
