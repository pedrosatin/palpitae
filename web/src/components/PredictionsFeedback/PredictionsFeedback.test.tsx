import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import PredictionsFeedback from './PredictionsFeedback'

const API = 'https://tbbc.app/api/rating'
const originalKey = config.tbbcSiteKey

function reply(status = 201, body: unknown = { ok: true, id: 'rating-1' }) {
  return new Response(JSON.stringify(body), { status })
}

describe('PredictionsFeedback', () => {
  beforeEach(() => {
    Object.assign(config, { tbbcSiteKey: 'k_test' })
  })

  afterEach(() => {
    Object.assign(config, { tbbcSiteKey: originalKey })
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('does not render or contact TBBC without a site key', () => {
    Object.assign(config, { tbbcSiteKey: '' })
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { container } = render(<PredictionsFeedback />)
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('explains the recipient before voting and dismisses without sending', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { rerender } = render(<PredictionsFeedback />)
    expect(screen.getByText(/Sua avaliação será enviada e armazenada pela/)).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    rerender(<PredictionsFeedback />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts only generic metadata without credentials, referer or local storage', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    window.history.replaceState({}, '', '/grupos/private-group?secret=example')
    render(<PredictionsFeedback />)
    await userEvent.click(screen.getByRole('button', { name: 'Não' }))
    await screen.findByText('Voto recebido. Quer contar mais?')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(API)
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(init!.body as string)).toEqual({
      site: 'k_test',
      vote: -1,
      section: 'predictions',
      app: 'palpitae',
      page: '/grupos/palpites',
      lang: 'pt-BR',
    })
    expect(storage).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Concluir sem comentário' }))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('waits for an accepted vote before offering the comment', async () => {
    let finish!: (value: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<PredictionsFeedback />)
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    expect(screen.getByText('Enviando avaliação...')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sim' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/recebido/)).not.toBeInTheDocument()
    await act(async () => finish(reply()))
    expect(await screen.findByLabelText('Comentário opcional')).toHaveAttribute('maxlength', '1000')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends only one vote on repeated clicks and aborts when dismissed', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    render(<PredictionsFeedback />)
    const yes = screen.getByRole('button', { name: 'Sim' })
    fireEvent.click(yes)
    fireEvent.click(yes)
    fireEvent.click(screen.getByRole('button', { name: 'Não' }))
    expect(fetch).toHaveBeenCalledTimes(1)
    const signal = fetch.mock.calls[0][1]!.signal!
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it.each([
    ['server failure', 500, { error: 'unavailable' }],
    ['missing id', 201, { ok: true }],
    ['missing confirmation', 201, { id: 'rating-1' }],
    ['null body', 201, null],
  ])('does not claim receipt after %s or retry automatically', async (_name, status, body) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(status, body))
    render(<PredictionsFeedback />)
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o envio')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/Voto recebido/)).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Sim' })).toBeEnabled()
  })

  it('retries a failed comment using the same vote and nonce', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply())
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValueOnce(reply(200))
    render(<PredictionsFeedback />)
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    await userEvent.type(await screen.findByLabelText('Comentário opcional'), 'Foi simples')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Comentário opcional')).toHaveValue('Foi simples')
    expect(screen.queryByText('Obrigado! Sua avaliação foi recebida.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }))
    expect(await screen.findByText('Obrigado! Sua avaliação foi recebida.')).toBeVisible()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      API,
      `${API}/rating-1`,
      `${API}/rating-1`,
    ])
    const first = JSON.parse(fetch.mock.calls[1][1]!.body as string)
    const retry = JSON.parse(fetch.mock.calls[2][1]!.body as string)
    expect(first).toEqual({ comment: 'Foi simples', nonce: expect.any(String) })
    expect(retry).toEqual(first)
  })

  it('does not send an empty comment and uses a new nonce when its text changes', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply(500))
      .mockResolvedValueOnce(reply(200))
    render(<PredictionsFeedback />)
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    const textbox = await screen.findByLabelText('Comentário opcional')
    expect(screen.getByRole('button', { name: 'Enviar comentário' })).toBeDisabled()
    await userEvent.type(textbox, 'Primeiro texto')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }))
    await screen.findByRole('alert')
    await userEvent.clear(textbox)
    await userEvent.type(textbox, 'Texto corrigido')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }))
    await screen.findByText('Obrigado! Sua avaliação foi recebida.')
    const first = JSON.parse(fetch.mock.calls[1][1]!.body as string)
    const changed = JSON.parse(fetch.mock.calls[2][1]!.body as string)
    expect(changed.comment).toBe('Texto corrigido')
    expect(changed.nonce).not.toBe(first.nonce)
  })

  it('aborts on dismissal and ignores an old response after remount', async () => {
    let finish!: (value: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { rerender } = render(<PredictionsFeedback key="account-one:group-one" />)
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    const signal = fetch.mock.calls[0][1]!.signal!
    rerender(<PredictionsFeedback key="account-two:group-two" />)
    expect(signal.aborted).toBe(true)
    await act(async () => finish(reply()))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sim' })).toBeEnabled()
  })

  it('times out a stalled request and permits a deliberate retry', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    render(<PredictionsFeedback />)
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível confirmar o envio')
    expect(screen.getByRole('button', { name: 'Sim' })).toBeEnabled()
  })
})
