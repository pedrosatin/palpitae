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
  it('lança erro se a SQL API responder com falha (!res.ok)', async () => {
    const fetchFake = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }))
    vi.stubGlobal('fetch', fetchFake)
    const env = makeEnv()

    await expect(exportEventsToR2(env, new Date('2026-06-20T13:45:00Z'))).rejects.toThrow(
      'AE SQL respondeu 500: Internal Server Error',
    )
  })

  it('um único segundo com mais linhas que a página: grava o que leu marcado como incompleto', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events = Array.from({ length: 10000 }).map(() => ({
      timestamp: '2026-06-20 13:45:00',
    }))
    const fetchFake = fetchOk(events)
    vi.stubGlobal('fetch', fetchFake)
    const env = makeEnv()

    await exportEventsToR2(env, new Date('2026-06-20T13:45:00Z'))
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('marcado como incompleto'))
    const [, , opts] = (env.EVENTS!.put as FetchFake).mock.calls[0]
    expect(opts.customMetadata).toMatchObject({ complete: '0' })
  })

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
    expect(opts.customMetadata).toEqual({ events: '4', rows: '2', complete: '1' })
  })

  it('dia vazio ({ data: [] }) grava um marcador vazio completo (para o backfill não re-consultar)', async () => {
    vi.stubGlobal('fetch', fetchOk([]))
    const env = makeEnv()

    await exportEventsToR2(env, new Date('2026-06-20T00:00:00Z'))

    expect(env.EVENTS!.put).toHaveBeenCalledTimes(1)
    const [key, body, opts] = (env.EVENTS!.put as FetchFake).mock.calls[0]
    expect(key).toBe('events/2026/06/20.ndjson')
    expect(body).toBe('')
    expect(opts.customMetadata).toEqual({ events: '0', rows: '0', complete: '1' })
  })
})

describe('exportRecentDays', () => {
  it('exporta só os dias faltantes, respeitando o teto por execução', async () => {
    const events = [{ a: 1 }]
    vi.stubGlobal('fetch', fetchOk(events))

    // head: dias pares já existem (com manifesto completo), ímpares faltam.
    const head = vi.fn(async (key: string) => {
      const dd = Number(key.slice(-9, -7)) // "DD" antes de ".ndjson"
      return dd % 2 === 0 ? { customMetadata: { events: '1', rows: '1', complete: '1' } } : null
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

  it('arquivo antigo SEM metadata e dia fora da retenção: mantém o corpo e fecha o dia com a contagem', async () => {
    // O AE já não tem o dia: a nova coleta vem vazia e não pode sobrescrever o arquivo.
    const fetchFake = fetchOk([])
    vi.stubGlobal('fetch', fetchFake)

    const ndjson = `${JSON.stringify({ a: 1, _sample_interval: 2 })}\n${JSON.stringify({ b: 2 })}\n`
    const head = vi.fn(async (key: string) =>
      key.endsWith('/24.ndjson')
        ? { size: ndjson.length, etag: 'e24' }
        : { customMetadata: { events: '1', rows: '1', complete: '1' } },
    )
    const get = vi.fn(async () => ({ text: async () => ndjson }))
    const put = vi.fn(async () => ({}))
    const env = makeEnv({ EVENTS: { head, get, put } as unknown as R2Bucket })

    await exportRecentDays(env, new Date('2026-06-30T00:05:00Z'), 6)

    expect(get).toHaveBeenCalledWith('events/2026/06/24.ndjson')
    expect(fetchFake).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    const [key, body, opts] = put.mock.calls[0] as unknown as [string, string, R2PutOptions]
    expect(key).toBe('events/2026/06/24.ndjson')
    expect(body).toBe(ndjson) // mesmo corpo — só ganha a metadata
    expect(opts.customMetadata).toEqual({ events: '3', rows: '2', complete: '1' }) // 2 + 1 (default)
    expect(opts.onlyIf).toEqual({ etagMatches: 'e24' })
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

  it('isola a falha no backfill de metadata de um dia — não trava os demais', async () => {
    vi.stubGlobal('fetch', fetchOk([]))

    const head = vi.fn(async () => ({ size: 24 })) // Sem manifesto: força o reparo

    let getCalls = 0
    const get = vi.fn(async () => {
      getCalls++
      if (getCalls === 1) throw new Error('R2 get falhou')
      return { text: async () => '{"_sample_interval": 1}\n' }
    })
    const put = vi.fn()
    const env = makeEnv({ EVENTS: { head, get, put } as unknown as R2Bucket })

    await exportRecentDays(env, new Date('2026-06-30T00:00:00Z'), 3)

    // O erro no primeiro get foi isolado e o loop continuou.
    // 3 head() -> todos caem em backfill. O primeiro falha no get().
    // Sobram 2 que fazem get() e put()
    expect(get).toHaveBeenCalledTimes(3)
    expect(put).toHaveBeenCalledTimes(2)
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

type AeRow = { timestamp: string; [column: string]: unknown }
type Stored = { body: string; customMetadata: Record<string, string>; etag: string }

/** SQL API falsa: respeita o intervalo de `timestamp`, a ordem e o LIMIT da consulta. */
function aeResponder(rows: AeRow[]) {
  return async (_url: string, init: { body: string }) => {
    const sql = String(init.body)
    const from = /timestamp >= toDateTime\('([^']+)'\)/.exec(sql)![1]
    const to = /timestamp < toDateTime\('([^']+)'\)/.exec(sql)![1]
    const limit = Number(/LIMIT (\d+)/.exec(sql)![1])
    const data = rows
      .filter((r) => r.timestamp >= from && r.timestamp < to)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .slice(0, limit)
    return { ok: true, json: async () => ({ data }) }
  }
}

function fakeAe(rows: AeRow[]): FetchFake {
  return vi.fn(aeResponder(rows))
}

/** R2 em memória com etag e `onlyIf.etagMatches`, como o binding real. */
function fakeBucket(initial: Record<string, { body: string; customMetadata?: Record<string, string> }> = {}) {
  let version = 0
  const store = new Map<string, Stored>()
  const failPutFor = new Set<string>()
  for (const [key, obj] of Object.entries(initial)) {
    store.set(key, { body: obj.body, customMetadata: obj.customMetadata ?? {}, etag: `v${version++}` })
  }
  const bucket = {
    head: vi.fn(async (key: string) => {
      const obj = store.get(key)
      return obj
        ? { key, size: obj.body.length, etag: obj.etag, customMetadata: { ...obj.customMetadata } }
        : null
    }),
    get: vi.fn(async (key: string) => {
      const obj = store.get(key)
      return obj ? { text: async () => obj.body } : null
    }),
    put: vi.fn(async (key: string, body: string, opts: R2PutOptions = {}) => {
      if (failPutFor.delete(key)) throw new Error('R2 put falhou')
      const match = (opts.onlyIf as R2Conditional | undefined)?.etagMatches
      if (match !== undefined && store.get(key)?.etag !== match) return null
      store.set(key, {
        body,
        customMetadata: { ...(opts.customMetadata as Record<string, string>) },
        etag: `v${version++}`,
      })
      return { key }
    }),
  }
  return { bucket, store, failPutFor }
}

function envWith(bucket: unknown): Env {
  return makeEnv({ EVENTS: bucket as R2Bucket })
}

function lines(body: string | undefined): string[] {
  return (body ?? '').split('\n').filter(Boolean)
}

describe('manifesto de completude e reparo do dia', () => {
  it('resposta da SQL API sem a lista de linhas é falha, não dia vazio: nada é gravado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ errors: ['timeout'] }) })),
    )
    const { bucket, store } = fakeBucket()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await exportRecentDays(envWith(bucket), new Date('2026-06-21T00:05:00Z'), 1)

    expect(store.has('events/2026/06/20.ndjson')).toBe(false)
  })

  it('dia com mais linhas que uma página é lido inteiro, sem repetir nem perder linhas', async () => {
    // Duas linhas por segundo: a página de 10 mil termina no meio de um segundo.
    const rows: AeRow[] = Array.from({ length: 10_005 }, (_, i) => {
      const second = Math.floor(i / 2)
      const hh = String(Math.floor(second / 3600)).padStart(2, '0')
      const mm = String(Math.floor((second % 3600) / 60)).padStart(2, '0')
      const ss = String(second % 60).padStart(2, '0')
      return { timestamp: `2026-06-20 ${hh}:${mm}:${ss}`, double1: i }
    })
    const fetchFake = fakeAe(rows)
    vi.stubGlobal('fetch', fetchFake)
    const { bucket, store } = fakeBucket()

    await exportEventsToR2(envWith(bucket), new Date('2026-06-20T00:00:00Z'))

    const saved = store.get('events/2026/06/20.ndjson')
    const ids = lines(saved?.body).map((l) => (JSON.parse(l) as AeRow).double1)
    expect(ids).toEqual(rows.map((r) => r.double1))
    expect(saved?.customMetadata).toEqual({ events: '10005', rows: '10005', complete: '1' })
    expect(fetchFake).toHaveBeenCalledTimes(2)
  })

  it('export das 00:05 é provisório; o cron seguinte reconsulta e fecha o dia com a linha que faltava', async () => {
    const rows: AeRow[] = [
      { timestamp: '2026-06-29 03:59:00', blob1: 'poller_run' },
      { timestamp: '2026-06-29 23:58:00', blob1: 'poller_run' },
    ]
    const fetchFake = fakeAe(rows)
    vi.stubGlobal('fetch', fetchFake)
    const { bucket, store } = fakeBucket()
    const key = 'events/2026/06/29.ndjson'

    await exportRecentDays(envWith(bucket), new Date('2026-06-30T00:05:00Z'), 1)
    expect(store.get(key)?.customMetadata).toEqual({ events: '2', rows: '2', complete: '0' })

    // A SQL API passa a devolver uma linha do dia que não vinha no primeiro export.
    rows.push({ timestamp: '2026-06-29 04:00:30', blob1: 'poller_run' })
    await exportRecentDays(envWith(bucket), new Date('2026-07-01T00:05:00Z'), 2)

    expect(lines(store.get(key)?.body)).toHaveLength(3)
    expect(store.get(key)?.customMetadata).toEqual({ events: '3', rows: '3', complete: '1' })

    // Dia completo não é mais consultado.
    fetchFake.mockClear()
    await exportRecentDays(envWith(bucket), new Date('2026-07-02T00:05:00Z'), 3)
    const queried = fetchFake.mock.calls.map((c) => String((c[1] as { body: string }).body))
    expect(queried.some((sql) => sql.includes("'2026-06-29 00:00:00'"))).toBe(false)
  })

  it('marcador vazio antigo é reconsultado: vira o arquivo do dia, ou dia vazio confirmado', async () => {
    vi.stubGlobal(
      'fetch',
      fakeAe([
        { timestamp: '2026-06-20 10:00:00', _sample_interval: 2 },
        { timestamp: '2026-06-20 11:00:00' },
      ]),
    )
    const { bucket, store } = fakeBucket({
      'events/2026/06/20.ndjson': { body: '', customMetadata: { events: '0' } },
      'events/2026/06/21.ndjson': { body: '', customMetadata: { events: '0' } },
    })

    await exportRecentDays(envWith(bucket), new Date('2026-06-23T00:05:00Z'), 3)

    expect(lines(store.get('events/2026/06/20.ndjson')?.body)).toHaveLength(2)
    expect(store.get('events/2026/06/20.ndjson')?.customMetadata).toEqual({
      events: '3',
      rows: '2',
      complete: '1',
    })
    // Sem eventos de fato: continua vazio, agora com manifesto de dia completo.
    expect(store.get('events/2026/06/21.ndjson')).toMatchObject({
      body: '',
      customMetadata: { events: '0', rows: '0', complete: '1' },
    })
  })

  it('falha no upload do reparo preserva o arquivo; a nova tentativa grava conteúdo e contagem esperados', async () => {
    const rows: AeRow[] = [
      { timestamp: '2026-06-20 10:00:00', double1: 1 },
      { timestamp: '2026-06-20 12:00:00', double1: 2 },
    ]
    vi.stubGlobal('fetch', fakeAe(rows))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const key = 'events/2026/06/20.ndjson'
    const previous = `${JSON.stringify(rows[0])}\n`
    const { bucket, store, failPutFor } = fakeBucket({
      [key]: { body: previous, customMetadata: { events: '1', rows: '1', complete: '0' } },
    })
    const before = store.get(key)
    failPutFor.add(key)

    await exportRecentDays(envWith(bucket), new Date('2026-06-22T00:05:00Z'), 2)
    expect(store.get(key)).toEqual(before)

    await exportRecentDays(envWith(bucket), new Date('2026-06-22T00:06:00Z'), 2)
    expect(store.get(key)?.body).toBe(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
    expect(store.get(key)?.customMetadata).toEqual({ events: '2', rows: '2', complete: '1' })
  })

  it('nova coleta com menos linhas não substitui o arquivo, que passa a ser o registro definitivo do dia', async () => {
    const fetchFake = fakeAe([{ timestamp: '2026-06-20 10:00:00' }])
    vi.stubGlobal('fetch', fetchFake)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const key = 'events/2026/06/20.ndjson'
    const body = '{"a":1}\n{"a":2}\n{"a":3}\n'
    const { bucket, store } = fakeBucket({
      [key]: { body, customMetadata: { events: '3', rows: '3', complete: '0' } },
    })

    await exportRecentDays(envWith(bucket), new Date('2026-06-22T00:05:00Z'), 2)

    expect(store.get(key)?.body).toBe(body)
    expect(store.get(key)?.customMetadata).toEqual({ events: '3', rows: '3', complete: '1' })

    // Dia fechado não é mais consultado.
    fetchFake.mockClear()
    await exportRecentDays(envWith(bucket), new Date('2026-06-23T00:05:00Z'), 3)
    const queried = fetchFake.mock.calls.map((c) => String((c[1] as { body: string }).body))
    expect(queried.some((sql) => sql.includes("'2026-06-20 00:00:00'"))).toBe(false)
  })

  it('objeto alterado durante o reparo não é sobrescrito', async () => {
    const key = 'events/2026/06/20.ndjson'
    const { bucket, store } = fakeBucket({
      [key]: { body: '', customMetadata: { events: '0' } },
    })
    const query = aeResponder([{ timestamp: '2026-06-20 10:00:00' }])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        // Outra execução grava o dia enquanto esta consulta o AE.
        if (String(init.body).includes("'2026-06-20 00:00:00'")) {
          await bucket.put(key, '{"outra":1}\n', {
            customMetadata: { events: '1', rows: '1', complete: '1' },
          })
        }
        return query(url, init)
      }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await exportRecentDays(envWith(bucket), new Date('2026-06-22T00:05:00Z'), 2)

    expect(store.get(key)?.body).toBe('{"outra":1}\n')
  })
})
