import { describe, it, expect } from 'vitest'
import { formatDate } from './PredictionsModal'

describe('formatDate', () => {
  it('formats an ISO date correctly for America/Sao_Paulo timezone', () => {
    // 2023-10-05T00:30:00Z UTC -> 2023-10-04T21:30:00-03:00 Sao Paulo
    const isoDate = '2023-10-05T00:30:00Z'
    const result = formatDate(isoDate)

    // Check for correct day and month
    expect(result).toMatch(/04/)
    expect(result).toMatch(/10/)

    // Check for correct time
    expect(result).toMatch(/21:30/)
  })

  it('formats another ISO date correctly handling daylight saving time boundaries or different hours', () => {
    // 2023-01-01T15:45:00Z UTC -> 2023-01-01T12:45:00-03:00 Sao Paulo
    const isoDate = '2023-01-01T15:45:00Z'
    const result = formatDate(isoDate)

    // Check for correct day and month
    expect(result).toMatch(/01/)
    expect(result).toMatch(/01/)

    // Check for correct time
    expect(result).toMatch(/12:45/)
  })

  it('handles invalid dates by throwing or returning invalid date string (depending on environment, but typically "Invalid Date" in browsers)', () => {
    const isoDate = 'invalid-date'
    const result = formatDate(isoDate)
    expect(result).toMatch(/Invalid Date|invalid/i)
  })
})
