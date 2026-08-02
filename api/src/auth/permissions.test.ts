import { describe, expect, it } from 'vitest'
import { hasFeatureAccess, getFeatureFlags } from './permissions'

describe('permissions', () => {
  describe('hasFeatureAccess', () => {
    it('should return true for create_group feature', () => {
      expect(hasFeatureAccess('test@example.com', 'create_group')).toBe(true)
    })

    it('should return true regardless of email', () => {
      expect(hasFeatureAccess('another@example.com', 'create_group')).toBe(true)
    })

    it('should return true for sync_matches feature', () => {
      expect(hasFeatureAccess('test@example.com', 'sync_matches')).toBe(true)
    })

    it('should return true for sync_matches regardless of email', () => {
      expect(hasFeatureAccess('another@example.com', 'sync_matches')).toBe(true)
    })
  })

  describe('getFeatureFlags', () => {
    it('should return feature flags with create_group set to true', () => {
      const flags = getFeatureFlags('test@example.com')
      expect(flags).toEqual({ create_group: true, sync_matches: true })
      expect(flags.create_group).toBe(true)
      expect(flags.sync_matches).toBe(true)
    })

    it('should return the same flags regardless of email', () => {
      const flags1 = getFeatureFlags('user1@example.com')
      const flags2 = getFeatureFlags('user2@example.com')
      expect(flags1).toEqual({ create_group: true, sync_matches: true })
      expect(flags2).toEqual({ create_group: true, sync_matches: true })
    })
  })
})
