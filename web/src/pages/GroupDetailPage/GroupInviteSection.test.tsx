import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import GroupInviteSection from './GroupInviteSection'
import * as ga from '../../analytics/ga'

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../components/ShareButtons', () => ({
  default: ({ shareLink }: { shareLink: string }) => (
    <div data-testid="share-buttons">{shareLink}</div>
  ),
}))

describe('GroupInviteSection', () => {
  const defaultProps = {
    inviteCode: 'TEST1234',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders correctly with invite code and link', () => {
    render(<GroupInviteSection {...defaultProps} />)

    expect(screen.getByText('Convidar membros')).toBeInTheDocument()
    expect(screen.getByText('TEST1234')).toBeInTheDocument()

    const expectedLink = `${window.location.origin}?convite=TEST1234`
    const linkElements = screen.getAllByText(expectedLink)
    expect(linkElements.length).toBeGreaterThan(0)
    expect(screen.getByTestId('share-buttons')).toHaveTextContent(expectedLink)
  })

  it('copies invite code and tracks event', async () => {
    render(<GroupInviteSection {...defaultProps} />)
    const copyCodeButton = screen.getByRole('button', { name: 'Copiar' })

    await act(async () => {
      fireEvent.click(copyCodeButton)
    })

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TEST1234')
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_group_detail_copiar_codigo')

    expect(screen.getByRole('button', { name: 'Copiado!' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      const copyButtons = screen.getAllByRole('button', { name: 'Copiar' })
      expect(copyButtons.length).toBeGreaterThan(0)
    })
  })

  it('copies share link and tracks event', async () => {
    render(<GroupInviteSection {...defaultProps} />)
    const copyLinkButton = screen.getByRole('button', { name: 'Copiar link' })

    await act(async () => {
      fireEvent.click(copyLinkButton)
    })

    const expectedLink = `${window.location.origin}?convite=TEST1234`
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink)
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_group_detail_copiar_link')

    expect(screen.getByRole('button', { name: 'Copiado!' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      const copyLinkButtons = screen.getAllByRole('button', { name: 'Copiar link' })
      expect(copyLinkButtons.length).toBeGreaterThan(0)
    })
  })
})
