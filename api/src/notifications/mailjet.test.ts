import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MailjetError,
  isTransientMailjetError,
  mailjetCredentials,
  sendMailjetEmail,
} from './mailjet'

const CREDS = { apiKey: 'public-key', apiSecret: 'private-secret' }

describe('mailjetCredentials', () => {
  it('exige as duas credenciais preenchidas', () => {
    expect(mailjetCredentials(undefined, 's')).toBeUndefined()
    expect(mailjetCredentials('k', undefined)).toBeUndefined()
    expect(mailjetCredentials('  ', 's')).toBeUndefined()
    expect(mailjetCredentials('k', '  ')).toBeUndefined()
    expect(mailjetCredentials('k', 's')).toEqual({ apiKey: 'k', apiSecret: 's' })
  })
})

describe('sendMailjetEmail', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            Messages: [{ Status: 'success', To: [{ MessageID: 99 }] }],
          }),
          { status: 200 },
        ),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posta na API v3.1 com Basic auth, CustomID e cabeçalhos do e-mail', async () => {
    const result = await sendMailjetEmail(
      CREDS,
      {
        to: 'a@example.com',
        subject: 'Oi',
        html: '<p>hi</p>',
        text: 'hi',
        headers: {
          'List-Unsubscribe': '<https://api.example/unsub>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      },
      'lembrete-diario/u1/2026-11-19',
    )

    expect(result.messageId).toBe('99')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.mailjet.com/v3.1/send')
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa('public-key:private-secret')}`,
    )
    const body = JSON.parse(init!.body as string)
    expect(body.Messages[0].CustomID).toBe('lembrete-diario/u1/2026-11-19')
    expect(body.Messages[0].To[0].Email).toBe('a@example.com')
    expect(body.Messages[0].From.Email).toBe('lembretes@palpitae.com.br')
    expect(body.Messages[0].Headers['List-Unsubscribe']).toContain('unsub')
  })

  it('lança MailjetError em HTTP de erro sem o corpo na mensagem', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"ErrorMessage":"a@example.com bounced"}', { status: 401 }),
    )
    await expect(
      sendMailjetEmail(CREDS, { to: 'a@example.com', subject: 'Oi', html: '<p>hi</p>' }, 'id'),
    ).rejects.toMatchObject({ name: 'MailjetError', status: 401, message: 'Mailjet respondeu 401' })
  })

  it('lança quando Status da mensagem não é success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ Messages: [{ Status: 'error', Errors: [] }] }), {
        status: 200,
      }),
    )
    await expect(
      sendMailjetEmail(CREDS, { to: 'a@example.com', subject: 'Oi', html: '<p>hi</p>' }, 'id'),
    ).rejects.toBeInstanceOf(MailjetError)
  })
})

describe('isTransientMailjetError', () => {
  it('trata 5xx e 429 como transitórios e 4xx definitivo como permanente', () => {
    expect(isTransientMailjetError(new MailjetError(500, 'x'))).toBe(true)
    expect(isTransientMailjetError(new MailjetError(429, 'x'))).toBe(true)
    expect(isTransientMailjetError(new MailjetError(400, 'x'))).toBe(false)
    expect(isTransientMailjetError(new Error('rede'))).toBe(true)
  })
})
