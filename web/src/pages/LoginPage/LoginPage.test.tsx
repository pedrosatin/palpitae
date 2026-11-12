import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as ga from '../../analytics/ga'
import LoginPage from './LoginPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

describe('LoginPage – analytics', () => {
  beforeEach(() => mockTrackEvent.mockClear())

  it('fires click_login_conheca when the preview link is clicked', async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('link', { name: /Conheça o Palpitae/i }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_login_conheca')
  })
})

describe('LoginPage – avisos', () => {
  beforeEach(() => sessionStorage.clear())

  function renderLogin() {
    return render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
  }

  it('mostra o aviso de sessão expirada uma vez', () => {
    sessionStorage.setItem('palpitae:session-expired', '1')
    const { unmount } = renderLogin()
    expect(screen.getByRole('alert')).toHaveTextContent('Sua sessão expirou')
    unmount()

    renderLogin()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('avisa, uma vez, que o servidor não confirmou o fim da sessão', () => {
    sessionStorage.setItem('palpitae:logout-unconfirmed', '1')
    const { unmount } = renderLogin()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Não conseguimos confirmar no servidor')
    expect(alert).toHaveTextContent('Sair de todos os dispositivos')
    expect(alert).not.toHaveTextContent('Sua sessão expirou')
    unmount()

    renderLogin()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
