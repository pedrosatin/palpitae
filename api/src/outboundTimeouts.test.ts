import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendEmail } from './notifications/email'
import { runAeSql } from './observability/aeSql'
import type { Env } from './types'

/** Request que nunca responde: só termina se quem chamou abortar pelo `signal`. */
function hangingFetch(_input: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('chamadas de saída penduradas abortam no timeout', () => {
  it.each([
    [
      'envio pelo Resend',
      () => sendEmail('key', { to: 'a@example.com', subject: 'Oi', html: '<p>Oi</p>' }),
    ],
    [
      'SQL API do Analytics Engine',
      () => runAeSql({ CF_ACCOUNT_ID: 'account', AE_SQL_TOKEN: 'token' } as Env, 'SELECT 1'),
    ],
  ])('%s', async (_label, call) => {
    // O timeout de produção é de segundos. Aqui todo `AbortSignal.timeout` vence em 20 ms.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(20))
    vi.stubGlobal('fetch', vi.fn(hangingFetch))

    await expect(call()).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
