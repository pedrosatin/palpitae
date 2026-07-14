import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ErrorState from './ErrorState'

describe('ErrorState', () => {
  it('renders the given message', () => {
    render(<ErrorState message="Erro ao carregar membros" />)
    expect(screen.getByText('Erro ao carregar membros')).toBeInTheDocument()
  })

  it('falls back to a generic message when none is given', () => {
    render(<ErrorState />)
    expect(screen.getByRole('alert')).toHaveTextContent(/erro ao carregar/i)
  })

  it('has role="alert" so screen readers announce it', () => {
    render(<ErrorState message="Falhou" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders children over message when provided', () => {
    render(
      <ErrorState message="ignored">
        <span>Falhou</span>
        <button type="button">Tentar novamente</button>
      </ErrorState>,
    )
    expect(screen.queryByText('ignored')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Tentar novamente' }),
    ).toBeInTheDocument()
  })

  it('appends custom className', () => {
    const { container } = render(<ErrorState message="x" className="custom" />)
    expect((container.firstChild as HTMLElement).className).toContain('custom')
  })
})
