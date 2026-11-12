import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Button from '../Button'
import ErrorState from '../ErrorState'
import ErrorBoundary from './ErrorBoundary'
import styles from './ErrorBoundary.module.css'

/**
 * Tela de uma página que quebrou no render. Como o cabeçalho também caiu, a tela
 * oferece o caminho de volta. O clique em "Voltar para o início" também tira o
 * erro, porque na própria `/` o caminho não muda.
 */
function PageError({ onBack }: { onBack: () => void }) {
  return (
    <main className={styles.page}>
      <ErrorState className={styles.notice}>
        <p>Algo deu errado ao mostrar esta página.</p>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Recarregar a página
          </Button>
          <Link to="/" className={styles.link} onClick={onBack}>
            Voltar para o início
          </Link>
        </div>
      </ErrorState>
    </main>
  )
}

/** Fronteira de erro da rota: trocar de caminho tira a tela de erro. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname} fallback={(reset) => <PageError onBack={reset} />}>
      {children}
    </ErrorBoundary>
  )
}

/** Tela de uma aba que quebrou no render. Cabeçalho e abas continuam na página. */
export function TabError({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState className={styles.notice}>
      <p>Não foi possível mostrar esta aba.</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </ErrorState>
  )
}
