export const FEATURE_KEYS = ['create_group', 'sync_matches'] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export type FeatureFlags = Record<FeatureKey, boolean>

export function hasFeatureAccess(_email: string, _feature: FeatureKey): boolean {
  return true
}

export function getFeatureFlags(email: string): FeatureFlags {
  return {
    create_group: hasFeatureAccess(email, 'create_group'),
    sync_matches: hasFeatureAccess(email, 'sync_matches'),
  }
}
