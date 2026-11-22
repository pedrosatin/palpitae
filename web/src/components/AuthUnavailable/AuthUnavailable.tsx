import Button from '../Button'
import ErrorState from '../ErrorState'
import styles from './AuthUnavailable.module.css'

interface AuthUnavailableProps {
  onRetry: () => void
  retrying?: boolean
}

/**
 * Tela para quando o `GET /auth/me` responde 5xx. Não dá para saber se há sessão,
 * então ninguém é mandado ao login: a URL fica como está e "Tentar novamente"
 * refaz a consulta.
 */
export default function AuthUnavailable({ onRetry, retrying = false }: AuthUnavailableProps) {
  return (
    <main className={styles.page}>
      <ErrorState className={styles.notice}>
        <p>O Palpitae está indisponível no momento. Tente de novo em instantes.</p>
        <Button
          variant="secondary"
          size="sm"
          aria-disabled={retrying}
          aria-busy={retrying}
          onClick={() => {
            if (!retrying) onRetry()
          }}
        >
          {retrying ? 'Tentando...' : 'Tentar novamente'}
        </Button>
      </ErrorState>
    </main>
  )
}
