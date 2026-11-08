import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../../components/Card'
import GoogleLoginButton from '../../components/GoogleLoginButton'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { markInviteAccepted, normalizeInviteCode } from '../../lib/invite'
import { describeScoring, type InvitePreview } from '../../lib/invitePreview'
import styles from './InvitePage.module.css'
import { useInvitePreview } from './useInvitePreview'

/**
 * Página de convite para quem ainda não tem sessão (`/convite/:code`).
 *
 * Mostra só o que o endpoint público entrega. O botão marca o convite como
 * aceito nesta aba e volta do Google em `/?convite=CODE`, onde o Dashboard faz a
 * entrada no grupo sem pedir confirmação.
 */
export default function InvitePage() {
  const { code: rawCode } = useParams()
  const code = normalizeInviteCode(rawCode)
  return <InviteContent key={code ?? rawCode} code={code} />
}

function InviteContent({ code }: { code: string | null }) {
  const state = useInvitePreview(code)

  useDocumentTitle(
    state.status === 'ready'
      ? `Convite para ${state.preview.groupName}`
      : state.status === 'invalid'
        ? 'Convite inválido'
        : 'Convite',
  )

  if (state.status === 'invalid' || !code) return <InvalidInvite code={code} />

  return (
    <InviteShell>
      {state.status === 'loading' && <p className={styles.notice}>Carregando convite...</p>}

      {state.status === 'unavailable' && (
        <div className={styles.heading}>
          <h1 className={styles.title}>Você recebeu um convite para um bolão</h1>
          <p className={styles.notice}>
            Os detalhes do grupo não carregaram agora. Entre para ver o convite.
          </p>
        </div>
      )}

      {state.status === 'ready' && <InviteDetails preview={state.preview} />}

      {state.status !== 'loading' && (
        <>
          <p className={styles.free}>Grátis, sem apostas</p>
          <GoogleLoginButton
            label="Entrar com Google e participar"
            redirect={`?convite=${encodeURIComponent(code)}`}
            onBeforeRedirect={() => markInviteAccepted(code)}
          />
          <p className={styles.hint}>Depois do login, você já entra no grupo.</p>
        </>
      )}

      <Link to="/" className={styles.landingLink}>
        Conhecer o Palpitae
      </Link>
    </InviteShell>
  )
}

function InviteDetails({ preview }: { preview: InvitePreview }) {
  const scoring = describeScoring(preview.pointsExact, preview.pointsWinner)
  return (
    <>
      <div className={styles.heading}>
        <p className={styles.eyebrow}>Convite para o bolão</p>
        <h1 className={styles.title}>{preview.groupName}</h1>
      </div>
      <dl className={styles.details}>
        {preview.competitionName && (
          <DetailRow label="Campeonato">{preview.competitionName}</DetailRow>
        )}
        {preview.adminName && <DetailRow label="Quem administra">{preview.adminName}</DetailRow>}
        <DetailRow label="Participantes">{preview.memberCount}</DetailRow>
        {scoring && <DetailRow label="Pontuação">{scoring}</DetailRow>}
      </dl>
    </>
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

/**
 * Código trocado, de grupo excluído ou que nunca existiu. O link de login cobre
 * quem tem acesso a um grupo de campeonato em piloto, que a rota pública trata
 * como inexistente. Depois do login, a entrada segue pelo modal do Dashboard.
 */
function InvalidInvite({ code }: { code: string | null }) {
  return (
    <InviteShell>
      <div className={styles.heading}>
        <h1 className={styles.title}>Este convite não vale mais</h1>
        <p className={styles.notice}>Peça um link novo a quem te convidou.</p>
      </div>
      <Link to="/" className={styles.landingButton}>
        Conhecer o Palpitae
      </Link>
      {code && (
        <Link to={`/entrar?convite=${encodeURIComponent(code)}`} className={styles.landingLink}>
          Já tem conta? Entre para conferir
        </Link>
      )}
    </InviteShell>
  )
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.root}>
      <Card className={styles.card}>
        <img src="/logo-text.svg" alt="Palpitae" className={styles.logo} />
        {children}
      </Card>
    </main>
  )
}
