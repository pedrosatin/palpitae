import Button from '../Button'
import ErrorState from '../ErrorState'
import styles from './AuthUnavailable.module.css'

/**
 * Tela para quando o `GET /auth/me` responde 5xx. Não dá para saber se há sessão,
 * então ninguém é mandado ao login: a URL fica como está e "Tentar novamente"
 * refaz a consulta.
 */
export default function AuthUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className={styles.page}>
      <ErrorState className={styles.notice}>
        <p>O Palpitae está indisponível no momento. Tente de novo em instantes.</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      </ErrorState>
    </main>
  )
}
