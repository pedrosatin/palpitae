import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import CreateGroupSuccessView from './CreateGroupSuccessView'
import * as ga from '../../../analytics/ga'

vi.mock('../../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../ShareButtons', () => ({
  default: ({ shareLink }: { shareLink: string }) => (
    <div data-testid="share-buttons">{shareLink}</div>
  ),
}))

const mockCreatedGroup = {
  id: 'test-group-id',
  name: 'Test Group',
  invite_code: 'TEST1234',
}

const defaultProps = {
  created: mockCreatedGroup,
  onClose: vi.fn(),
}

describe('CreateGroupSuccessView', () => {
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

  it('renders group information correctly', () => {
    render(<CreateGroupSuccessView {...defaultProps} />)
    expect(screen.getByText('Grupo criado!')).toBeInTheDocument()
    expect(screen.getByText('Test Group')).toBeInTheDocument()
    expect(screen.getByText('TEST1234')).toBeInTheDocument()
    expect(screen.getAllByText(`${window.location.origin}?convite=TEST1234`)[0]).toBeInTheDocument()
  })

  it('copies invite code and tracks event', async () => {
    render(<CreateGroupSuccessView {...defaultProps} />)
    const copyCodeButton = screen.getByRole('button', { name: 'Copiar' })

    fireEvent.click(copyCodeButton)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TEST1234')
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_copiar_codigo')

    const copiedButtons = screen.getAllByRole('button', { name: 'Copiado!' })
    expect(copiedButtons.length).toBeGreaterThan(0)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      const copyButtons = screen.getAllByRole('button', { name: 'Copiar' })
      expect(copyButtons.length).toBeGreaterThan(0)
    })
  })

  it('copies share link and tracks event', async () => {
    render(<CreateGroupSuccessView {...defaultProps} />)
    const copyLinkButton = screen.getByRole('button', { name: 'Copiar link' })

    fireEvent.click(copyLinkButton)

    const expectedLink = `${window.location.origin}?convite=TEST1234`
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink)
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_copiar_link')

    const copiedButtons = screen.getAllByRole('button', { name: 'Copiado!' })
    expect(copiedButtons.length).toBeGreaterThan(0)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      const copyLinkButtons = screen.getAllByRole('button', { name: 'Copiar link' })
      expect(copyLinkButtons.length).toBeGreaterThan(0)
    })
  })

  it('calls onClose when Pronto button is clicked', async () => {
    render(<CreateGroupSuccessView {...defaultProps} />)
    const prontoButton = screen.getByRole('button', { name: 'Pronto' })

    fireEvent.click(prontoButton)

    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})
