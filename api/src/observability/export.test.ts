import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../types'
import { dayBounds, exportEventsToR2, exportRecentDays } from './export'

type FetchFake = ReturnType<typeof vi.fn>

function fetchOk(data: unknown[]): FetchFake {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ data }),
  }))
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    EVENTS: { put: vi.fn(), head: vi.fn(async () => null) },
    CF_ACCOUNT_ID: 'acct',
    AE_SQL_TOKEN: 'tok',
    ...overrides,
  } as unknown as Env
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dayBounds', () => {
  it('computes UTC [00:00, next 00:00) bounds and the R2 key', () => {
    const { from, to, key } = dayBounds(new Date('2026-06-20T13:45:00Z'))
    expect(from).toBe('2026-06-20 00:00:00')
    expect(to).toBe('2026-06-21 00:00:00')
    expect(key).toBe('events/2026/06/20.ndjson')
  })

  it('rolls over month/year and zero-pads', () => {
    expect(dayBounds(new Date('2026-12-31T23:59:59Z'))).toMatchObject({
      from: '2026-12-31 00:00:00',
      to: '2027-01-01 00:00:00',
      key: 'events/2026/12/31.ndjson',
    })
    expect(dayBounds(new Date('2026-01-05T00:00:00Z')).key).toBe('events/2026/01/05.ndjson')
  })

  it('handles leap years correctly', () => {
    expect(dayBounds(new Date('2024-02-28T12:00:00Z'))).toMatchObject({
      from: '2024-02-28 00:00:00',
      to: '2024-02-29 00:00:00',
      key: 'events/2024/02/28.ndjson',
    })
    expect(dayBounds(new Date('2024-02-29T12:00:00Z'))).toMatchObject({
      from: '2024-02-29 00:00:00',
      to: '2024-03-01 00:00:00',
      key: 'events/2024/02/29.ndjson',
    })
  })

  it('handles non-leap year February correctly', () => {
    expect(dayBounds(new Date('2023-02-28T12:00:00Z'))).toMatchObject({
      from: '2023-02-28 00:00:00',
      to: '2023-03-01 00:00:00',
      key: 'events/2023/02/28.ndjson',
    })
  })

  it('throws TypeError for invalid dates', () => {
    expect(() => dayBounds(new Date('invalid-date-string'))).toThrow(TypeError)
    expect(() => dayBounds(new Date(NaN))).toThrow('Invalid Date')
  })
})

describe('exportEventsToR2', () => {
  it('é no-op sem EVENTS/credenciais — não chama fetch nem put', async () => {
    const fetchFake = vi.fn()
    vi.stubGlobal('fetch', fetchFake)
    const put = vi.fn()
    const env = { EVENTS: { put } } as unknown as Env // falta CF_ACCOUNT_ID/AE_SQL_TOKEN

    await exportEventsToR2(env, new Date('2026-06-20T00:00:00Z'))

    expect(fetchFake).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('happy path: grava NDJSON na chave correta com a contagem em customMetadata', async () => {
    // Sob sampling cada linha vale _sample_interval eventos: 3 + 1 (default) = 4.
    const events = [{ a: 1, _sample_interval: 3 }, { b: 2 }]
    const fetchFake = fetchOk(events)
    vi.stubGlobal('fetch', fetchFake)
    const env = makeEnv()

    await exportEventsToR2(env, new Date('2026-06-20T13:45:00Z'))

    expect(fetchFake).toHaveBeenCalledTimes(1)
    expect(env.EVENTS!.put).toHaveBeenCalledTimes(1)
    const [key, body, opts] = (env.EVENTS!.put as FetchFake).mock.calls[0]
    expect(key).toBe('events/2026/06/20.ndjson')
    expect(body).toBe(`${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}\n`)
    expect(opts.customMetadata).toEqual({ events: '4' })
  })

  it('dia vazio ({ data: [] }) grava um marcador vazio (para o backfill não re-consultar)', async () => {
    vi.stubGlobal('fetch', fetchOk([]))
    const env = makeEnv()

    await exportEventsToR2(env, new Date('2026-06-20T00:00:00Z'))

    expect(env.EVENTS!.put).toHaveBeenCalledTimes(1)
    const [key, body, opts] = (env.EVENTS!.put as FetchFake).mock.calls[0]
    expect(key).toBe('events/2026/06/20.ndjson')
    expect(body).toBe('')
    expect(opts.customMetadata).toEqual({ events: '0' })
  })
})

describe('exportRecentDays', () => {
  it('exporta só os dias faltantes, respeitando o teto por execução', async () => {
    const events = [{ a: 1 }]
    vi.stubGlobal('fetch', fetchOk(events))

    // head: dias pares já existem (com contagem em metadata), ímpares faltam.
    const head = vi.fn(async (key: string) => {
      const dd = Number(key.slice(-9, -7)) // "DD" antes de ".ndjson"
      return dd % 2 === 0 ? { customMetadata: { events: '1' } } : null
    })
    const put = vi.fn()
    const env = makeEnv({ EVENTS: { head, put } as unknown as R2Bucket })

    // today = 30 -> verifica back=1..lookback (dias 29,28,27,...). Teto = 10 exports.
    await exportRecentDays(env, new Date('2026-06-30T00:00:00Z'), 90)

    // Não pode exportar mais que o teto de 10 por execução.
    expect(put.mock.calls.length).toBeLessThanOrEqual(10)
    expect(put.mock.calls.length).toBeGreaterThan(0)

    // Nenhum dia par (já existente) foi exportado.
    for (const [key] of put.mock.calls as [string][]) {
      const dd = Number(key.slice(-9, -7))
      expect(dd % 2).toBe(1)
    }
  })

  it('arquivo existente SEM metadata: conta do próprio NDJSON e regrava com a contagem', async () => {
    const fetchFake = vi.fn()
    vi.stubGlobal('fetch', fetchFake)

    // Dia 29 existe sem metadata (export antigo); demais dias existem com metadata.
    const ndjson = `${JSON.stringify({ a: 1, _sample_interval: 2 })}\n${JSON.stringify({ b: 2 })}\n`
    const head = vi.fn(async (key: string) =>
      key.endsWith('/29.ndjson') ? {} : { customMetadata: { events: '1' } },
    )
    const get = vi.fn(async () => ({ text: async () => ndjson }))
    const put = vi.fn()
    const env = makeEnv({ EVENTS: { head, get, put } as unknown as R2Bucket })

    await exportRecentDays(env, new Date('2026-06-30T00:00:00Z'), 5)

    // Não re-consulta o AE (dia pode já ter saído da retenção — o re-export
    // gravaria um marcador vazio por cima do arquivo bom).
    expect(fetchFake).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith('events/2026/06/29.ndjson')
    expect(put).toHaveBeenCalledTimes(1)
    const [key, body, opts] = put.mock.calls[0]
    expect(key).toBe('events/2026/06/29.ndjson')
    expect(body).toBe(ndjson) // mesmo corpo — só ganha a metadata
    expect(opts.customMetadata).toEqual({ events: '3' }) // 2 + 1 (default)
  })

  it('é no-op sem credenciais', async () => {
    const fetchFake = vi.fn()
    vi.stubGlobal('fetch', fetchFake)
    const head = vi.fn()
    const env = { EVENTS: { head, put: vi.fn() } } as unknown as Env

    await exportRecentDays(env, new Date('2026-06-30T00:00:00Z'))

    expect(head).not.toHaveBeenCalled()
    expect(fetchFake).not.toHaveBeenCalled()
  })

  it('isola a falha de um dia — não trava o backfill dos demais', async () => {
    // 1ª chamada à SQL API lança; as seguintes funcionam. Loop não pode parar.
    let n = 0
    const fetchFake = vi.fn(async () => {
      n++
      if (n === 1) throw new Error('SQL API blip')
      return { ok: true, json: async () => ({ data: [{ a: 1 }] }) }
    })
    vi.stubGlobal('fetch', fetchFake)
    const put = vi.fn()
    const env = makeEnv({
      EVENTS: { head: vi.fn(async () => null), put } as unknown as R2Bucket,
    })

    await exportRecentDays(env, new Date('2026-06-30T00:00:00Z'), 3)

    // 3 dias tentados (loop não parou no erro); o dia que falhou não gravou.
    expect(fetchFake).toHaveBeenCalledTimes(3)
    expect(put).toHaveBeenCalledTimes(2)
  })
})
