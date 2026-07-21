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
    logRequestPerf(undefined, '/api/test', {
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
    logRequestPerf(undefined, '/api/test', {
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
    logRequestPerf(undefined, '/api/test', {
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
    logRequestPerf(undefined, '/api/test', {
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
    logRequestPerf(undefined, '/api/test', {
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

  it('writes a request_perf datapoint to the Analytics Engine (route/status blobs, ms/rows doubles)', () => {
    const writeDataPoint = vi.fn()
    const ae = { writeDataPoint } as unknown as AnalyticsEngineDataset

    logRequestPerf(ae, 'GET /matches', {
      status: 200,
      totalMs: 12.34,
      dbMs: 5.6,
      rows: 7,
      // extra é alta cardinalidade — não deve virar dimensão no AE.
      extra: { competition_id: 'BSA' },
    })

    expect(writeDataPoint).toHaveBeenCalledTimes(1)
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ['request_perf'],
      blobs: ['request_perf', 'GET /matches', '200'],
      doubles: [12.3, 5.6, 7],
    })
  })

  it('defaults missing db_ms/rows to 0 in the Analytics Engine doubles', () => {
    const writeDataPoint = vi.fn()
    const ae = { writeDataPoint } as unknown as AnalyticsEngineDataset

    logRequestPerf(ae, 'GET /groups', { status: 200, totalMs: 8 })

    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ['request_perf'],
      blobs: ['request_perf', 'GET /groups', '200'],
      doubles: [8, 0, 0],
    })
  })
})
