import { describe, expect, it } from 'vitest'
import { hasFeatureAccess, getFeatureFlags, FEATURE_KEYS } from './permissions'

describe('permissions', () => {
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
    it('should map all features using hasFeatureAccess for a given email', () => {
      const email = 'test@example.com'
      const flags = getFeatureFlags(email)

      const expectedFlags = FEATURE_KEYS.reduce((acc, key) => {
        acc[key] = hasFeatureAccess(email, key)
        return acc
      }, {} as Record<string, boolean>)

      expect(flags).toEqual(expectedFlags)
    })

    it('should correctly map features for different users', () => {
      const emails = ['user1@example.com', 'admin@example.com']

      emails.forEach((email) => {
        const flags = getFeatureFlags(email)
        const expectedFlags = FEATURE_KEYS.reduce((acc, key) => {
          acc[key] = hasFeatureAccess(email, key)
          return acc
        }, {} as Record<string, boolean>)

        expect(flags).toEqual(expectedFlags)
      })
    })

    it('should handle edge case emails', () => {
      const emails = ['', '   ', 'invalid-email', 'admin+test@example.com']

      emails.forEach((email) => {
        const flags = getFeatureFlags(email)
        const expectedFlags = FEATURE_KEYS.reduce((acc, key) => {
          acc[key] = hasFeatureAccess(email, key)
          return acc
        }, {} as Record<string, boolean>)

        expect(flags).toEqual(expectedFlags)
      })
    })
  })
})
