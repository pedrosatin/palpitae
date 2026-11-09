import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import CreateGroupSuccessView from './CreateGroupSuccessView'
import * as ga from '../../../analytics/ga'

vi.mock('../../../analytics/ga', () => ({
  trackEvent: vi.fn(),
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

const WHATSAPP_ACTION = 'Chamar a galera no WhatsApp'
const INVITE_MESSAGE = 'Entra no meu bolão "Test Group" no Palpitae:'
const INVITE_LINK = `${window.location.origin}/convite/TEST1234`

function stubPhone(share: (data: ShareData) => Promise<void>) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  Object.assign(navigator, { share: vi.fn(share) })
  return navigator.share as ReturnType<typeof vi.fn>
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'share')
  })

  it('renders group information correctly', () => {
    render(<CreateGroupSuccessView {...defaultProps} />)
    expect(screen.getByText('Grupo criado!')).toBeInTheDocument()
    expect(screen.getByText('Test Group')).toBeInTheDocument()
    expect(screen.getByText('TEST1234')).toBeInTheDocument()
    expect(screen.getAllByText(`${window.location.origin}/convite/TEST1234`)[0]).toBeInTheDocument()
  })

  it('puts the WhatsApp action first and Pronto last', () => {
    render(<CreateGroupSuccessView {...defaultProps} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName(WHATSAPP_ACTION)
    expect(buttons[buttons.length - 1]).toHaveAccessibleName('Pronto')
  })

  it('does not repeat the WhatsApp icon below the main action', () => {
    render(<CreateGroupSuccessView {...defaultProps} />)

    expect(
      screen.queryByRole('button', { name: 'Compartilhar no WhatsApp' }),
    ).not.toBeInTheDocument()
  })

  it('opens WhatsApp with the message and the link on desktop', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<CreateGroupSuccessView {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: WHATSAPP_ACTION }))

    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    const url = new URL(open.mock.calls[0][0] as string)
    expect(url.hostname).toBe('wa.me')
    expect(url.searchParams.get('text')).toBe(`${INVITE_MESSAGE} ${INVITE_LINK}`)
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_whatsapp')
    await waitFor(() =>
      expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
        method: 'whatsapp',
        context: 'create_group',
      }),
    )
  })

  it('opens the native share sheet on a phone', async () => {
    const share = stubPhone(() => Promise.resolve())
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<CreateGroupSuccessView {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: WHATSAPP_ACTION }))

    await waitFor(() =>
      expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
        method: 'native',
        context: 'create_group',
      }),
    )
    expect(share).toHaveBeenCalledWith({
      title: 'Palpitae',
      text: INVITE_MESSAGE,
      url: INVITE_LINK,
    })
    expect(open).not.toHaveBeenCalled()
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_whatsapp')
  })

  it('does not count a cancelled share sheet as an invite', async () => {
    const share = stubPhone(() => Promise.reject(new DOMException('cancelled', 'AbortError')))
    render(<CreateGroupSuccessView {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: WHATSAPP_ACTION }))

    await waitFor(() => expect(share).toHaveBeenCalledOnce())
    await act(async () => {
      await Promise.resolve()
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_whatsapp')
    expect(ga.trackEvent).not.toHaveBeenCalledWith('share_invite', expect.anything())
  })

  it('keeps the events of the other share buttons', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<CreateGroupSuccessView {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Compartilhar no X' }))
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_twitter')
    expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'twitter',
      context: 'create_group',
    })
    expect(new URL(open.mock.calls[0][0] as string).searchParams.get('text')).toBe(INVITE_MESSAGE)

    fireEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))
    await waitFor(() =>
      expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
        method: 'copy_link',
        context: 'create_group',
      }),
    )
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_compartilhar')
  })

  it('copies invite code and tracks event', async () => {
    render(<CreateGroupSuccessView {...defaultProps} />)
    const copyCodeButton = screen.getByRole('button', { name: 'Copiar' })

    fireEvent.click(copyCodeButton)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TEST1234')
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_copiar_codigo')
    expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'copy_code',
      context: 'create_group',
    })

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

    const expectedLink = `${window.location.origin}/convite/TEST1234`
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink)
    })
    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_copiar_link')
    expect(ga.trackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'copy_link',
      context: 'create_group',
    })

    const copiedButtons = screen.getAllByRole('button', { name: 'Copiado!' })
    expect(copiedButtons.length).toBeGreaterThan(0)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      const copyLinkButtons = screen.getAllByRole('button', { name: 'Copiar link' })
      expect(copyLinkButtons.length).toBeGreaterThan(0)
    })
  })

  it('tracks Pronto and closes the modal', () => {
    render(<CreateGroupSuccessView {...defaultProps} />)
    const prontoButton = screen.getByRole('button', { name: 'Pronto' })

    fireEvent.click(prontoButton)

    expect(ga.trackEvent).toHaveBeenCalledWith('click_create_group_pronto')
    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})
