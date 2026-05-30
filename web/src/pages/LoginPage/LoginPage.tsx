import { Link } from 'react-router-dom'
import Card from '../../components/Card'
import GoogleLoginButton from '../../components/GoogleLoginButton'
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
  return (
    <main className={styles.root}>
      <Card className={styles.card}>
        <img src="/logo-text.svg" alt="Palpitae logo" className={styles.logo} />

        <div className={styles.text}>
          <h1 className={styles.title}>Bem-vindo ao Palpitae</h1>
          <p className={styles.subtitle}>Bolões de futebol com seus amigos</p>
        </div>

        <GoogleLoginButton />

        <Link to="/conheca" className={styles.previewLink}>
          Conheça o Palpitae antes de entrar →
        </Link>
      </Card>
    </main>
  )
}
