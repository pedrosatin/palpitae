import { describe, expect, it } from 'vitest'
import { hasFeatureAccess, getFeatureFlags, FEATURE_KEYS } from './permissions'

describe('permissions', () => {
  it('exposes create_group as the only feature key', () => {
    expect(FEATURE_KEYS).toEqual(['create_group'])
  })

  describe('hasFeatureAccess', () => {
    it('should return true for all feature keys', () => {
      FEATURE_KEYS.forEach((feature) => {
        expect(hasFeatureAccess('test@example.com', feature)).toBe(true)
        expect(hasFeatureAccess('another@example.com', feature)).toBe(true)
      })
    })

    it('should handle edge case emails', () => {
      const edgeCaseEmails = ['', '   ', 'invalid-email', 'admin+test@example.com']
      edgeCaseEmails.forEach((email) => {
        FEATURE_KEYS.forEach((feature) => {
          expect(hasFeatureAccess(email, feature)).toBe(true)
        })
      })
    })
  })

  describe('getFeatureFlags', () => {
    it('maps create_group for a given email', () => {
      expect(getFeatureFlags('test@example.com')).toEqual({ create_group: true })
    })

    it('should correctly map features for different users', () => {
      const emails = ['user1@example.com', 'admin@example.com']

      emails.forEach((email) => {
        expect(getFeatureFlags(email)).toEqual({
          create_group: hasFeatureAccess(email, 'create_group'),
        })
      })
    })

    it('should handle edge case emails', () => {
      const emails = ['', '   ', 'invalid-email', 'admin+test@example.com']

      emails.forEach((email) => {
        expect(getFeatureFlags(email)).toEqual({ create_group: true })
      })
    })
  })
})
