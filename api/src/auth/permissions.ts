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

/**
 * Quem faz a requisição, como o D1 grava a conta. `googleSub` é o `provider_id` da
 * conta e só existe quando `provider = 'google'`, porque `provider_id` de outro
 * provedor não é um `sub` do Google.
 */
export type AccountIdentity = {
  email: string | undefined
  googleSub: string | undefined
}

/** `sub` do Google de uma linha de `users`. Conta de outro provedor não tem. */
export function googleSubOf(
  provider: string | null | undefined,
  providerId: string | null | undefined,
): string | undefined {
  return provider === 'google' && providerId ? providerId : undefined
}

type AdminEnv = Pick<Env, 'ADMIN_EMAIL' | 'ADMIN_GOOGLE_SUB'>

/**
 * Admin é a conta cujo e-mail é o `ADMIN_EMAIL`. Com `ADMIN_GOOGLE_SUB` definido, o
 * `sub` do Google da conta também precisa ser esse, o que barra um e-mail reciclado
 * que passe a ser de outra pessoa. Vazio ou ausente, vale só o e-mail. O e-mail
 * ignora caixa e espaços nas pontas.
 */
export function isAdminUser(identity: AccountIdentity, env: AdminEnv): boolean {
  const normalizedEmail = identity.email?.trim().toLowerCase()
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!normalizedEmail || !adminEmail) return false
  if (normalizedEmail !== adminEmail) return false
  const adminSub = env.ADMIN_GOOGLE_SUB?.trim()
  return !adminSub || identity.googleSub === adminSub
}

export function hasPilotAccess(
  identity: AccountIdentity,
  env: AdminEnv & Pick<Env, 'PILOT_EMAILS'>,
): boolean {
  const normalizedEmail = identity.email?.trim().toLowerCase()
  if (!normalizedEmail) return false
  if (isAdminUser(identity, env)) return true
  if (!env.PILOT_EMAILS) return false

  const pilotEmails = env.PILOT_EMAILS.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  return pilotEmails.includes(normalizedEmail)
}
