/** Authenticated user profile, as returned by /auth/me. */
export interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
  feature_flags?: {
    create_group?: boolean
  }
}
