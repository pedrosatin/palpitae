import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailError, sendEmail } from './email'

describe('EmailError', () => {
  it('sets status, message, and name correctly', () => {
    const error = new EmailError(422, 'Unprocessable Entity')
    expect(error.name).toBe('EmailError')
    expect(error.status).toBe(422)
    expect(error.message).toBe('Resend respondeu 422: Unprocessable Entity')
    expect(error.retryAfterMs).toBeUndefined()
  })

  it('parses retryAfter when provided as a valid string', () => {
    const error = new EmailError(429, 'Rate Limited', '60')
    expect(error.retryAfterMs).toBe(60000)
  })

  it('leaves retryAfterMs undefined when retryAfter is null or missing', () => {
    const error1 = new EmailError(500, 'Server Error', null)
    expect(error1.retryAfterMs).toBeUndefined()

    const error2 = new EmailError(500, 'Server Error')
    expect(error2.retryAfterMs).toBeUndefined()
  })

  it('leaves retryAfterMs undefined when retryAfter is an invalid number', () => {
    const error = new EmailError(429, 'Rate Limited', 'invalid')
    expect(error.retryAfterMs).toBeUndefined()
  })
})

describe('sendEmail', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to the Resend API with auth, from and payload', async () => {
    await sendEmail('secret-key', {
      to: 'a@x.com',
      subject: 'Oi',
      html: '<p>hi</p>',
      text: 'hi',
    })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
    const body = JSON.parse(init!.body as string)
    expect(body.from).toContain('palpitae.com.br')
    expect(body.to).toBe('a@x.com')
    expect(body.subject).toBe('Oi')
    expect(body.html).toBe('<p>hi</p>')
    expect(body.text).toBe('hi')
  })

  it('omits text when not provided', async () => {
    await sendEmail('key', { to: 'a@x.com', subject: 'Oi', html: '<p>hi</p>' })

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body).not.toHaveProperty('text')
  })

  it('does not throw on a 2xx response', async () => {
    await expect(
      sendEmail('key', { to: 'a@x.com', subject: 'Oi', html: '<p>hi</p>' }),
    ).resolves.toBeUndefined()
  })

  it('throws on a 4xx response, surfacing status and body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('bad request', { status: 422 }))

    await expect(
      sendEmail('key', { to: 'a@x.com', subject: 'Oi', html: '<p>hi</p>' }),
    ).rejects.toThrow('422')
  })

  it('throws on a 429 (rate limit)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('rate limited', { status: 429 }))

    await expect(
      sendEmail('key', { to: 'a@x.com', subject: 'Oi', html: '<p>hi</p>' }),
    ).rejects.toThrow('429')
  })
})
