import { describe, expect, it } from 'vitest'
import {
  FEATURE_KEYS,
  getFeatureFlags,
  hasFeatureAccess,
  hasPilotAccess,
  isAdminUser,
} from './permissions'

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

  describe('isAdminUser', () => {
    it('matches ADMIN_EMAIL case-insensitively', () => {
      expect(isAdminUser('Admin@Example.com', { ADMIN_EMAIL: 'admin@example.com' })).toBe(true)
      expect(isAdminUser('  admin@example.com  ', { ADMIN_EMAIL: ' ADMIN@EXAMPLE.COM ' })).toBe(
        true,
      )
    })

    it('returns false when ADMIN_EMAIL is missing, empty, or different', () => {
      expect(isAdminUser('admin@example.com', {})).toBe(false)
      expect(isAdminUser('admin@example.com', { ADMIN_EMAIL: '   ' })).toBe(false)
      expect(isAdminUser('user@example.com', { ADMIN_EMAIL: 'admin@example.com' })).toBe(false)
      expect(isAdminUser(undefined, { ADMIN_EMAIL: 'admin@example.com' })).toBe(false)
      expect(isAdminUser('', { ADMIN_EMAIL: 'admin@example.com' })).toBe(false)
    })
  })

  describe('hasPilotAccess', () => {
    const env = {
      ADMIN_EMAIL: 'admin@palpitae.com.br',
      PILOT_EMAILS: 'convidado1@example.com, Convidado2@Example.com , ',
    }

    it('grants access to the admin user', () => {
      expect(hasPilotAccess('ADMIN@palpitae.com.br', env)).toBe(true)
      expect(
        hasPilotAccess('admin@palpitae.com.br', { ADMIN_EMAIL: 'admin@palpitae.com.br' }),
      ).toBe(true)
    })

    it('grants access to guests listed in PILOT_EMAILS case-insensitively', () => {
      expect(hasPilotAccess('convidado1@example.com', env)).toBe(true)
      expect(hasPilotAccess('CONVIDADO1@example.com', env)).toBe(true)
      expect(hasPilotAccess('convidado2@example.com', env)).toBe(true)
    })

    it('denies access to ordinary users and empty emails', () => {
      expect(hasPilotAccess('comum@example.com', env)).toBe(false)
      expect(hasPilotAccess(undefined, env)).toBe(false)
      expect(hasPilotAccess('   ', env)).toBe(false)
      expect(hasPilotAccess('convidado1@example.com', {})).toBe(false)
    })
  })
})
