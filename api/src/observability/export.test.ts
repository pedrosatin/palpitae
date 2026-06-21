import { describe, expect, it } from 'vitest'
import { dayBounds } from './export'

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
})
