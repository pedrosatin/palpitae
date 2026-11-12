import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** Quando muda (outra rota, outra aba), a tela de erro sai e os filhos montam de novo. */
  resetKey?: unknown
  /** Tela no lugar dos filhos que quebraram. `reset` monta os filhos de novo. */
  fallback: (reset: () => void) => ReactNode
  children?: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Segura o erro de render dos filhos para ele não desmontar o app inteiro e
 * deixar a página em branco. O React registra o erro no console.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState) {
    // Só sai do erro numa navegação feita depois dele. No render que acabou de
    // quebrar, `prevState.failed` ainda é falso.
    if (prevState.failed && this.state.failed && prevProps.resetKey !== this.props.resetKey)
      this.reset()
  }

  reset = () => this.setState({ failed: false })

  render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children
  }
}
