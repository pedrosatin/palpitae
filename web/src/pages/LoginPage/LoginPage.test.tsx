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
