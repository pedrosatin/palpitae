import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import Card from '../../components/Card'
import GoogleLoginButton from '../../components/GoogleLoginButton'
import { trackEvent } from '../../analytics/ga'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import styles from './LoginPage.module.css'

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

  // Attribution for the static guide pages: they link here with ?from=guia_<slug>.
  // The click can't be tracked there (JS-less static HTML), so we fire the event
  // on arrival instead. Lets us see which content drove people to sign in.
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from')
    if (from) trackEvent('entrar_origem', { origem: from })
  }, [])

  return (
    <main className={styles.root}>
      <Card className={styles.card}>
        <img src="/logo-text.svg" alt="Palpitae logo" className={styles.logo} />

        <div className={styles.text}>
          <h1 className={styles.title}>Bem-vindo ao Palpitae</h1>
          <p className={styles.subtitle}>Bolões de futebol com seus amigos</p>
        </div>

        <GoogleLoginButton />

        <Link to="/" className={styles.previewLink} onClick={() => trackEvent('click_login_conheca')}>
          ← Conheça o Palpitae
        </Link>
      </Card>
    </main>
  )
}
