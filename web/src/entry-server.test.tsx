import { describe, it, expect } from 'vitest'
import { render } from './entry-server'

describe('entry-server', () => {
  it('should render the app to a string', () => {
    const result = render()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)

    // Check if App is rendered (which includes the landing page)
    expect(result).toContain('Bolões de futebol')
    expect(result).toContain('Palpitae')
  })
})
