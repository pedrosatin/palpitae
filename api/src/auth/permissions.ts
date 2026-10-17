import type { Env } from '../types'

export const FEATURE_KEYS = ['create_group'] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export type FeatureFlags = Record<FeatureKey, boolean>

export function hasFeatureAccess(_email: string, _feature: FeatureKey): boolean {
  return true
}

export function getFeatureFlags(email: string): FeatureFlags {
  return {
    create_group: hasFeatureAccess(email, 'create_group'),
  }
}

export function isAdminUser(email: string | undefined, env: Pick<Env, 'ADMIN_EMAIL'>): boolean {
  const normalizedEmail = email?.trim().toLowerCase()
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!normalizedEmail || !adminEmail) return false
  return normalizedEmail === adminEmail
}

export function hasPilotAccess(
  email: string | undefined,
  env: Pick<Env, 'ADMIN_EMAIL' | 'PILOT_EMAILS'>,
): boolean {
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail) return false
  if (isAdminUser(normalizedEmail, env)) return true
  if (!env.PILOT_EMAILS) return false

  const pilotEmails = env.PILOT_EMAILS.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  return pilotEmails.includes(normalizedEmail)
}
