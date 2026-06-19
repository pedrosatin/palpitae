import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CookieConsent from './CookieConsent'
import * as ga from '../../analytics/ga'

vi.mock('../../analytics/ga', () => ({
  gaEnabled: true,
  getStoredConsent: vi.fn(),
  setConsent: vi.fn(),
}))

const mockGetStoredConsent = vi.mocked(ga.getStoredConsent)
const mockSetConsent = vi.mocked(ga.setConsent)

describe('CookieConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the banner when no choice has been made yet', () => {
    mockGetStoredConsent.mockReturnValue(null)
    render(<CookieConsent />)
    expect(screen.getByRole('dialog', { name: 'Aviso de cookies' })).toBeInTheDocument()
  })

  it('stays hidden once a choice was already stored', () => {
    mockGetStoredConsent.mockReturnValue('granted')
    render(<CookieConsent />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('grants consent and dismisses the banner on "Aceitar"', async () => {
    mockGetStoredConsent.mockReturnValue(null)
    render(<CookieConsent />)
    await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }))
    expect(mockSetConsent).toHaveBeenCalledWith('granted')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('denies consent and dismisses the banner on "Recusar"', async () => {
    mockGetStoredConsent.mockReturnValue(null)
    render(<CookieConsent />)
    await userEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    expect(mockSetConsent).toHaveBeenCalledWith('denied')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
