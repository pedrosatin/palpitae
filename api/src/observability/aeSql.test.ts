import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAeSql } from './aeSql'
import type { Env } from '../types'

describe('runAeSql', () => {
  const mockEnv = {
    CF_ACCOUNT_ID: 'test-account-id',
    AE_SQL_TOKEN: 'test-token',
  } as Env

  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('makes a POST request to the correct URL with correct headers and body', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ col1: 'val1' }] }),
    }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response)

    const sql = 'SELECT * FROM test'
    const result = await runAeSql(mockEnv, sql)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account-id/analytics_engine/sql',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: 'SELECT * FROM test',
      }
    )
    expect(result).toEqual([{ col1: 'val1' }])
  })

  it('throws an error if the response is not ok', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('Bad Request'),
    }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response)

    const sql = 'SELECT * FROM test'

    await expect(runAeSql(mockEnv, sql)).rejects.toThrow('AE SQL respondeu 400: Bad Request')
  })

  it('returns an empty array if data is missing from the payload', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response)

    const sql = 'SELECT * FROM test'
    const result = await runAeSql(mockEnv, sql)

    expect(result).toEqual([])
  })
})
