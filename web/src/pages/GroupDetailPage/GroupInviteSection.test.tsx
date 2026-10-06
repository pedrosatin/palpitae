import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import GroupInviteSection from './GroupInviteSection'
import * as ga from '../../analytics/ga'

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../components/ShareButtons', () => ({
  default: ({ shareLink, message }: { shareLink: string; message?: string }) => (
    <div data-testid="share-buttons" data-message={message}>
      {shareLink}
    </div>
  ),
}))

describe('GroupInviteSection', () => {
  const defaultProps = {
    inviteCode: 'TEST1234',
    groupName: 'Os Craques',
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

    const expectedLink = `${window.location.origin}/convite/TEST1234`
    const linkElements = screen.getAllByText(expectedLink)
    expect(linkElements.length).toBeGreaterThan(0)
    expect(screen.getByTestId('share-buttons')).toHaveTextContent(expectedLink)
    expect(screen.getByTestId('share-buttons')).toHaveAttribute(
      'data-message',
      'Entra no meu bolão "Os Craques" no Palpitae:',
    )
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
    expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'copy_code',
      context: 'group_detail',
    })

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

    const expectedLink = `${window.location.origin}/convite/TEST1234`
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink)
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_group_detail_copiar_link')
    expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'copy_link',
      context: 'group_detail',
    })

    expect(screen.getByRole('button', { name: 'Copiado!' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      const copyLinkButtons = screen.getAllByRole('button', { name: 'Copiar link' })
      expect(copyLinkButtons.length).toBeGreaterThan(0)
    })
  })

  it('hides the rotate button without a handler', () => {
    render(<GroupInviteSection {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'Trocar código' })).not.toBeInTheDocument()
  })

  it('calls onRotate and disables the button while rotating', () => {
    const onRotate = vi.fn()
    const { rerender } = render(<GroupInviteSection {...defaultProps} onRotate={onRotate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Trocar código' }))
    expect(onRotate).toHaveBeenCalledTimes(1)

    rerender(<GroupInviteSection {...defaultProps} onRotate={onRotate} rotating />)
    expect(screen.getByRole('button', { name: 'Trocando...' })).toBeDisabled()
  })
})
