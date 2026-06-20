import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import styles from './GoogleLoginButton.module.css'

/**
 * "Sign in with Google" button.
 *
 * Clicking navigates to the backend's GET /auth/google endpoint, which
 * sets the PKCE verifier/state cookies and redirects the user to Google.
 * All OAuth handling lives in the API — no tokens are ever touched here.
 *
 * Styled per Google's Sign-In Button branding guidelines:
 *   white surface, Google multicolour "G" logo, dark label text.
 */
export default function GoogleLoginButton() {
  function handleClick() {
    trackEvent('click_login_google')
    const redirect =
      window.location.search || window.location.pathname !== '/'
        ? window.location.search
        : ''
    const url = new URL(`${config.authUrl}/auth/google`)
    if (redirect) url.searchParams.set('redirect', redirect)
    window.location.href = url.toString()
  }

  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleClick}
      aria-label="Entrar com Google"
    >
      <GoogleLogo className={styles.icon} />
      <span>Entrar com Google</span>
    </button>
  )
}

/**
 * Google's official multicolour "G" logo mark.
 * Rendered inline so no external image request is needed.
 */
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.15 0 5.65 1.08 7.7 2.87l5.74-5.74C33.97 3.5 29.3 1.5 24 1.5 15.26 1.5 7.88 6.96 4.6 14.64l6.72 5.22C12.98 13.66 17.99 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24c0-1.6-.14-3.14-.4-4.63H24v9.25h12.7c-.55 2.9-2.2 5.35-4.7 7l6.72 5.22C42.5 37.02 46.5 30.96 46.5 24z"
      />
      <path
        fill="#FBBC05"
        d="M11.32 28.14A14.5 14.5 0 0 1 9.5 24c0-1.44.25-2.84.69-4.14L3.47 14.64A22.44 22.44 0 0 0 1.5 24c0 3.46.83 6.73 2.3 9.62l7.52-5.48z"
      />
      <path
        fill="#34A853"
        d="M24 46.5c5.83 0 10.74-1.93 14.32-5.25l-6.72-5.22C29.73 37.7 26.99 38.5 24 38.5c-6.01 0-11.02-4.16-12.68-9.76l-7.52 5.48C7.12 41.7 14.9 46.5 24 46.5z"
      />
    </svg>
  )
}
