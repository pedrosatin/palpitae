export interface Competition {
  id: string
  name: string
  slug: string
  season: string | null
  status: 'upcoming' | 'ongoing' | 'finished'
  has_penalty_phases?: boolean
}

export interface CreatedGroup {
  id: string
  name: string
  invite_code: string
}
