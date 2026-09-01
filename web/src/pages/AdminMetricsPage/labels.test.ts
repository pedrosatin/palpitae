import { describe, expect, it } from 'vitest'
import { eventLabel } from './labels'

describe('labels', () => {
  describe('eventLabel', () => {
    it('returns translated label for known event types', () => {
      expect(eventLabel('login_success')).toBe('Login')
      expect(eventLabel('group_created')).toBe('Grupo criado')
    })

    it('returns raw key for unknown event types', () => {
      expect(eventLabel('unknown_event')).toBe('unknown_event')
      expect(eventLabel('another_unknown')).toBe('another_unknown')
    })
  })
})
