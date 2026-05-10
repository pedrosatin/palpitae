import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import GoogleLoginButton from './GoogleLoginButton'

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
