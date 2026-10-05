import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as ga from '../../analytics/ga'
import ShareButtons from './ShareButtons'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const LINK = 'https://palpitae.com.br/convite/ABCD-EF23'

/** Remove navigator.share para simular navegador sem Web Share (desktop). */
function disableWebShare() {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'share')
}

/** Instala um mock de navigator.share. */
function enableWebShare(impl: (data: ShareData) => Promise<void>) {
  Object.assign(navigator, { share: vi.fn(impl) })
  return navigator.share as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  mockTrackEvent.mockClear()
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  disableWebShare()
  vi.restoreAllMocks()
})

describe('ShareButtons', () => {
  it('renders the three share controls', () => {
    disableWebShare()
    render(<ShareButtons shareLink={LINK} eventContext="group_detail" />)
    expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compartilhar no WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compartilhar no X' })).toBeInTheDocument()
  })

  it('uses the native Web Share sheet when available and tracks the event', async () => {
    const share = enableWebShare(() => Promise.resolve())
    render(<ShareButtons shareLink={LINK} eventContext="group_detail" />)

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_compartilhar')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Palpitae', url: LINK }))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'native',
      context: 'group_detail',
    })
  })

  it('treats an aborted share as a no-op (no clipboard fallback)', async () => {
    enableWebShare(() => Promise.reject(new DOMException('cancelled', 'AbortError')))
    render(<ShareButtons shareLink={LINK} eventContext="group_detail" />)

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(screen.queryByText('Link copiado!')).not.toBeInTheDocument()
    expect(mockTrackEvent).not.toHaveBeenCalledWith('share_invite', expect.anything())
  })

  it('falls back to copying the link when a non-abort share error occurs', async () => {
    enableWebShare(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')))
    render(<ShareButtons shareLink={LINK} eventContext="group_detail" />)

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK)
    await waitFor(() => expect(screen.getByText('Link copiado!')).toBeInTheDocument())
  })

  it('copies the link when Web Share is unsupported', async () => {
    disableWebShare()
    render(<ShareButtons shareLink={LINK} eventContext="create_group" />)

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_compartilhar')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK)
    await waitFor(() => expect(screen.getByText('Link copiado!')).toBeInTheDocument())
    expect(mockTrackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'copy_link',
      context: 'create_group',
    })
  })

  it('opens WhatsApp with the prefilled link and tracks the event', async () => {
    disableWebShare()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<ShareButtons shareLink={LINK} eventContext="group_detail" />)

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar no WhatsApp' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_group_detail_whatsapp')
    const url = open.mock.calls[0][0] as string
    expect(url).toContain('https://wa.me/?text=')
    expect(url).toContain(encodeURIComponent(LINK))
    expect(mockTrackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'whatsapp',
      context: 'group_detail',
    })
  })

  it('sends the custom message with the link to WhatsApp', async () => {
    disableWebShare()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const message = 'Entra no meu bolão "Os Craques" no Palpitae:'
    render(<ShareButtons shareLink={LINK} eventContext="group_detail" message={message} />)

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar no WhatsApp' }))

    const url = new URL(open.mock.calls[0][0] as string)
    expect(url.searchParams.get('text')).toBe(`${message} ${LINK}`)
  })

  it('opens X/Twitter with the prefilled link and tracks the event', async () => {
    disableWebShare()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<ShareButtons shareLink={LINK} eventContext="create_group" />)

    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar no X' }))

    expect(mockTrackEvent).toHaveBeenCalledWith('click_create_group_twitter')
    const url = open.mock.calls[0][0] as string
    expect(url).toContain('twitter.com/intent/tweet')
    expect(url).toContain(`url=${encodeURIComponent(LINK)}`)
  })
})
