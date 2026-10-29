export interface Competition {
  id: string
  name: string
  slug: string
  season: string | null
  status: string
  /** True when the competition has knockout phases that decide on penalties. */
  has_penalty_phases?: boolean
}

export interface CreatedGroup {
  id: string
  name: string
  invite_code: string
}
