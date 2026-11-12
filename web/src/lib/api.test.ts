import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  notifySessionExpired,
  consumeSessionExpired,
  clearSessionExpired,
  notifyLogoutUnconfirmed,
  consumeLogoutUnconfirmed,
  apiFetch,
  readApiError,
  SESSION_EXPIRED_EVENT,
} from './api'

describe('api', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('notifySessionExpired', () => {
    it('sets session storage flag and dispatches event', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      notifySessionExpired()

      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBe('1')
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      const event = dispatchEventSpy.mock.calls[0][0]
      expect((event as Event).type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('dispatches event even if sessionStorage throws', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded')
      })

      notifySessionExpired()

      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      const event = dispatchEventSpy.mock.calls[0][0]
      expect((event as Event).type).toBe(SESSION_EXPIRED_EVENT)
    })

    it('returns early if window is undefined', () => {
      vi.stubGlobal('window', undefined)
      expect(() => notifySessionExpired()).not.toThrow()
    })
  })

  describe('consumeSessionExpired', () => {
    it('returns false if flag is not set', () => {
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns true and removes flag if it is set to "1"', () => {
      window.sessionStorage.setItem('palpitae:session-expired', '1')
      expect(consumeSessionExpired()).toBe(true)
      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBeNull()
    })

    it('returns false and removes flag if it is set to something else', () => {
      window.sessionStorage.setItem('palpitae:session-expired', '0')
      expect(consumeSessionExpired()).toBe(false)
      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBeNull()
    })

    it('returns false if sessionStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Private mode')
      })
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if window is undefined', () => {
      vi.stubGlobal('window', undefined)
      expect(consumeSessionExpired()).toBe(false)
    })

    it('returns false if accessing sessionStorage throws', () => {
      const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
        throw new Error('SecurityError')
      })
      expect(consumeSessionExpired()).toBe(false)
      spy.mockRestore()
    })
  })

  describe('clearSessionExpired', () => {
    it('apaga o aviso pendente sem disparar o evento', () => {
      window.sessionStorage.setItem('palpitae:session-expired', '1')
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      clearSessionExpired()

      expect(consumeSessionExpired()).toBe(false)
      expect(dispatchEventSpy).not.toHaveBeenCalled()
    })

    it('não lança sem sessionStorage', () => {
      vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
        throw new Error('SecurityError')
      })
      expect(() => clearSessionExpired()).not.toThrow()
    })
  })

  describe('logout sem confirmação do servidor', () => {
    it('o aviso vale para uma única leitura', () => {
      expect(consumeLogoutUnconfirmed()).toBe(false)
      notifyLogoutUnconfirmed()
      expect(consumeLogoutUnconfirmed()).toBe(true)
      expect(consumeLogoutUnconfirmed()).toBe(false)
    })

    it('não lança quando o sessionStorage recusa a escrita', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded')
      })
      expect(() => notifyLogoutUnconfirmed()).not.toThrow()
      expect(consumeLogoutUnconfirmed()).toBe(false)
    })
  })

  describe('apiFetch', () => {
    it('calls fetch with credentials: "include"', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      await apiFetch('/test-url')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith('/test-url', { credentials: 'include' })
    })

    it('merges RequestInit options while keeping credentials: "include"', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      await apiFetch('/test-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      expect(fetchMock).toHaveBeenCalledWith('/test-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
    })

    it('notifies session expired if response status is 401', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      await apiFetch('/test-url')

      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBe('1')
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
    })

    it('does not notify session expired if response status is not 401', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      await apiFetch('/test-url')

      expect(window.sessionStorage.getItem('palpitae:session-expired')).toBeNull()
      expect(dispatchEventSpy).not.toHaveBeenCalled()
    })
  })
})

describe('readApiError', () => {
  it('devolve a mensagem do servidor', async () => {
    const res = Response.json({ error: 'Grupo cheio' }, { status: 409 })

    expect(await readApiError(res, 'Erro ao entrar no grupo')).toBe('Grupo cheio')
  })

  it.each(['{}', 'null', '{"error":123}', '{"error":""}'])(
    'usa o texto da ação quando o JSON %s não traz mensagem',
    async (body) => {
      const res = new Response(body, { status: 500 })

      expect(await readApiError(res, 'Erro ao entrar no grupo')).toBe('Erro ao entrar no grupo')
    },
  )

  it('usa `message` quando o JSON não traz `error`', async () => {
    const res = Response.json({ message: 'Limite de grupos atingido' }, { status: 409 })

    expect(await readApiError(res, 'Erro ao criar grupo')).toBe('Limite de grupos atingido')
  })

  it.each([
    '{"error":"Grupo cheio","message":"Conflict"}',
    '{"message":"Conflict","error":"Grupo cheio"}',
  ])('prefere `error` a `message` em %s', async (body) => {
    const res = new Response(body, { status: 409 })

    expect(await readApiError(res, 'Erro ao entrar no grupo')).toBe('Grupo cheio')
  })

  it('devolve aviso de conexão quando o corpo não é JSON', async () => {
    const res = new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
      status: 502,
    })

    expect(await readApiError(res, 'Erro ao entrar no grupo')).toBe(
      'Erro de conexão. Tente novamente.',
    )
  })
})
