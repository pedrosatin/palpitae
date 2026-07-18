import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logRequestPerf } from './index'

describe('logRequestPerf', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should log basic metrics correctly', () => {
    logRequestPerf('/api/test', {
      status: 200,
      totalMs: 123.456,
    })

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[perf]',
      JSON.stringify({
        route: '/api/test',
        status: 200,
        total_ms: 123.5, // Check rounding
      }),
    )
  })

  it('should include db_ms if provided', () => {
    logRequestPerf('/api/test', {
      status: 200,
      totalMs: 123.456,
      dbMs: 45.678,
    })

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[perf]',
      JSON.stringify({
        route: '/api/test',
        status: 200,
        total_ms: 123.5,
        db_ms: 45.7, // Check rounding
      }),
    )
  })

  it('should include rows if provided', () => {
    logRequestPerf('/api/test', {
      status: 200,
      totalMs: 123.456,
      rows: 42,
    })

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[perf]',
      JSON.stringify({
        route: '/api/test',
        status: 200,
        total_ms: 123.5,
        rows: 42,
      }),
    )
  })

  it('should include extra fields at the root level if provided', () => {
    logRequestPerf('/api/test', {
      status: 200,
      totalMs: 123.456,
      extra: {
        cache_hit: true,
        user_id: '12345',
        region: null,
      },
    })

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[perf]',
      JSON.stringify({
        route: '/api/test',
        status: 200,
        total_ms: 123.5,
        cache_hit: true,
        user_id: '12345',
        region: null,
      }),
    )
  })

  it('should handle all fields combined', () => {
    logRequestPerf('/api/test', {
      status: 404,
      totalMs: 0.123,
      dbMs: 0.045,
      rows: 0,
      extra: {
        reason: 'not found',
      },
    })

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[perf]',
      JSON.stringify({
        route: '/api/test',
        status: 404,
        total_ms: 0.1,
        db_ms: 0,
        rows: 0,
        reason: 'not found',
      }),
    )
  })
})
