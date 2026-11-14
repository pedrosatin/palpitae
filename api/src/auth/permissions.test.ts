import { describe, expect, it } from 'vitest'
import {
  FEATURE_KEYS,
  getFeatureFlags,
  googleSubOf,
  hasFeatureAccess,
  hasPilotAccess,
  isAdminUser,
} from './permissions'

/** Identidade sem `sub` do Google, como a de quem entra por e-mail apenas. */
const semSub = (email: string | undefined) => ({ email, googleSub: undefined })

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
      expect(isAdminUser(semSub('Admin@Example.com'), { ADMIN_EMAIL: 'admin@example.com' })).toBe(
        true,
      )
      expect(
        isAdminUser(semSub('  admin@example.com  '), { ADMIN_EMAIL: ' ADMIN@EXAMPLE.COM ' }),
      ).toBe(true)
    })

    it('returns false when ADMIN_EMAIL is missing, empty, or different', () => {
      expect(isAdminUser(semSub('admin@example.com'), {})).toBe(false)
      expect(isAdminUser(semSub('admin@example.com'), { ADMIN_EMAIL: '   ' })).toBe(false)
      expect(isAdminUser(semSub('user@example.com'), { ADMIN_EMAIL: 'admin@example.com' })).toBe(
        false,
      )
      expect(isAdminUser(semSub(undefined), { ADMIN_EMAIL: 'admin@example.com' })).toBe(false)
      expect(isAdminUser(semSub(''), { ADMIN_EMAIL: 'admin@example.com' })).toBe(false)
    })

    describe('com ADMIN_GOOGLE_SUB', () => {
      const env = { ADMIN_EMAIL: 'admin@example.test', ADMIN_GOOGLE_SUB: 'sub-certo' }
      const conta = (googleSub: string | undefined, email = 'admin@example.test') => ({
        email,
        googleSub,
      })

      it('exige o e-mail e o sub do Google', () => {
        expect(isAdminUser(conta('sub-certo'), env)).toBe(true)
        expect(isAdminUser(conta('sub-certo', 'ADMIN@Example.test'), env)).toBe(true)
        expect(isAdminUser(conta('sub-errado'), env)).toBe(false)
        expect(isAdminUser(conta(undefined), env)).toBe(false)
        expect(isAdminUser(conta('sub-certo', 'outro@example.test'), env)).toBe(false)
      })

      it('ignora espaços do segredo e vale só o e-mail quando ele está vazio', () => {
        expect(isAdminUser(conta('sub-certo'), { ...env, ADMIN_GOOGLE_SUB: ' sub-certo\n' })).toBe(
          true,
        )
        expect(isAdminUser(conta(undefined), { ...env, ADMIN_GOOGLE_SUB: '' })).toBe(true)
        expect(isAdminUser(conta(undefined), { ...env, ADMIN_GOOGLE_SUB: '  ' })).toBe(true)
      })
    })
  })

  describe('googleSubOf', () => {
    it('só devolve o provider_id de conta Google', () => {
      expect(googleSubOf('google', 'sub-1')).toBe('sub-1')
      expect(googleSubOf('github', 'sub-1')).toBeUndefined()
      expect(googleSubOf('google', '')).toBeUndefined()
      expect(googleSubOf(null, 'sub-1')).toBeUndefined()
      expect(googleSubOf(undefined, undefined)).toBeUndefined()
    })
  })

  describe('hasPilotAccess', () => {
    const env = {
      ADMIN_EMAIL: 'admin@palpitae.com.br',
      PILOT_EMAILS: 'convidado1@example.com, Convidado2@Example.com , ',
    }

    it('grants access to the admin user', () => {
      expect(hasPilotAccess(semSub('ADMIN@palpitae.com.br'), env)).toBe(true)
      expect(
        hasPilotAccess(semSub('admin@palpitae.com.br'), { ADMIN_EMAIL: 'admin@palpitae.com.br' }),
      ).toBe(true)
    })

    it('grants access to guests listed in PILOT_EMAILS case-insensitively', () => {
      expect(hasPilotAccess(semSub('convidado1@example.com'), env)).toBe(true)
      expect(hasPilotAccess(semSub('CONVIDADO1@example.com'), env)).toBe(true)
      expect(hasPilotAccess(semSub('convidado2@example.com'), env)).toBe(true)
    })

    it('denies access to ordinary users and empty emails', () => {
      expect(hasPilotAccess(semSub('comum@example.com'), env)).toBe(false)
      expect(hasPilotAccess(semSub(undefined), env)).toBe(false)
      expect(hasPilotAccess(semSub('   '), env)).toBe(false)
      expect(hasPilotAccess(semSub('convidado1@example.com'), {})).toBe(false)
    })
  })
})
