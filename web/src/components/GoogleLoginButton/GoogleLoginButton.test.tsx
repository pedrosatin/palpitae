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
    expect(
      screen.getByRole('button', { name: 'Entrar com Google' }),
    ).toBeInTheDocument()
  })

  it('navigates to the Google auth URL on click', async () => {
    render(<GoogleLoginButton />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Entrar com Google' }),
    )
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
})
