const FEATURE_KEYS = ['create_group'] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

const FEATURE_ALLOWLISTS: Record<FeatureKey, readonly string[]> = {
  create_group: ['pedro5satin@gmail.com'],
}

export type FeatureFlags = Record<FeatureKey, boolean>

export function hasFeatureAccess(email: string, feature: FeatureKey): boolean {
  const normalizedEmail = email.toLowerCase()
  return FEATURE_ALLOWLISTS[feature].includes(normalizedEmail)
}

export function getFeatureFlags(email: string): FeatureFlags {
  return {
    create_group: hasFeatureAccess(email, 'create_group'),
  }
}