import { useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../../components/Card'
import ErrorState from '../../components/ErrorState'
import GoogleLoginButton from '../../components/GoogleLoginButton'
import { trackEvent } from '../../analytics/ga'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { consumeLogoutUnconfirmed, consumeSessionExpired } from '../../lib/api'
import styles from './LoginPage.module.css'

const SESSION_EXPIRED_NOTICE = 'Sua sessão expirou. Entre novamente para continuar.'
const LOGOUT_UNCONFIRMED_NOTICE =
  'Não conseguimos confirmar no servidor o fim da sua sessão. Se este aparelho for compartilhado, entre de novo e use “Sair de todos os dispositivos” em Configurações.'

function consumeLoginNotice(): string | null {
  const logoutUnconfirmed = consumeLogoutUnconfirmed()
  const sessionExpired = consumeSessionExpired()
  if (logoutUnconfirmed) return LOGOUT_UNCONFIRMED_NOTICE
  return sessionExpired ? SESSION_EXPIRED_NOTICE : null
}

/**
 * Login page — entry point for unauthenticated users.
 *
 * Layout: full-viewport centered card containing the logo, a short
 * tagline, and a single "Sign in with Google" CTA.
 *
 * The button navigates to the backend's /auth/google endpoint, which
 * initiates the PKCE OAuth2 flow. No credentials are handled client-side.
 */
export default function LoginPage() {
  useDocumentTitle('Entrar')

  const [notice] = useState(consumeLoginNotice)

  return (
    <main className={styles.root}>
      <Card className={styles.card}>
        <img src="/logo-text.svg" alt="Palpitae logo" className={styles.logo} />

        {notice && <ErrorState className={styles.sessionNotice} message={notice} />}

        <div className={styles.text}>
          <h1 className={styles.title}>Bem-vindo ao Palpitae</h1>
          <p className={styles.subtitle}>Bolões de futebol com seus amigos</p>
        </div>

        <GoogleLoginButton />

        <Link
          to="/"
          className={styles.previewLink}
          onClick={() => trackEvent('click_login_conheca')}
        >
          ← Conheça o Palpitae
        </Link>

        <a href="/privacidade" className={styles.privacyLink}>
          Política de privacidade
        </a>
      </Card>
    </main>
  )
}
