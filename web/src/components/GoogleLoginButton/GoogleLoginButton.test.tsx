import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import GoogleLoginButton from './GoogleLoginButton'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

describe('GoogleLoginButton', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: '/', search: '' },
    })
  })

  it('renders the sign-in button', () => {
    render(<GoogleLoginButton />)
    expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeInTheDocument()
  })

  it('navigates to the Google auth URL on click', async () => {
    render(<GoogleLoginButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }))
    expect(window.location.href).toContain('/auth/google')
  })

  it('volta para o grupo e a rodada do link do e-mail depois do login', async () => {
    Object.assign(window.location, { pathname: '/grupos/g1', search: '?rodada=35' })
    render(<GoogleLoginButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }))
    expect(new URL(window.location.href).searchParams.get('redirect')).toBe(
      '/grupos/g1?rodada=35',
    )
  })

  it('fora de um grupo mantém só a query no redirect', async () => {
    Object.assign(window.location, { pathname: '/', search: '?convite=ABC' })
    render(<GoogleLoginButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }))
    expect(new URL(window.location.href).searchParams.get('redirect')).toBe('?convite=ABC')
  })
})

describe('GoogleLoginButton com contexto de convite', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: '/convite/ABCD-EF23', search: '' },
    })
  })

  it('usa o rótulo informado', () => {
    render(<GoogleLoginButton label="Entrar com Google e participar" />)
    expect(
      screen.getByRole('button', { name: 'Entrar com Google e participar' }),
    ).toBeInTheDocument()
  })

  it('envia o redirect informado', async () => {
    render(<GoogleLoginButton redirect="?convite=ABCD-EF23" />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }))

    expect(new URL(window.location.href).searchParams.get('redirect')).toBe('?convite=ABCD-EF23')
  })

  it('chama onBeforeRedirect antes de sair para o Google', async () => {
    const onBeforeRedirect = vi.fn(() => expect(window.location.href).toBe(''))
    render(<GoogleLoginButton onBeforeRedirect={onBeforeRedirect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }))

    expect(onBeforeRedirect).toHaveBeenCalledTimes(1)
    expect(window.location.href).toContain('/auth/google')
  })
})

describe('GoogleLoginButton – analytics', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: '/', search: '' },
    })
  })

  it('fires click_login_google when the button is clicked', async () => {
    render(<GoogleLoginButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_login_google')
  })

  it('marks the tab so the App can count the completed login on return', async () => {
    sessionStorage.clear()
    render(<GoogleLoginButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }))
    expect(sessionStorage.getItem('palpitae:login-pendente')).toBe('google')
    // O evento `login` só sai na volta, com a sessão confirmada.
    expect(mockTrackEvent).not.toHaveBeenCalledWith('login', expect.anything())
  })
})
