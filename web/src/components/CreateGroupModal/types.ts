export interface Competition {
  id: string
  name: string
  slug: string
  season: string | null
  /**
   * Status derivado do backend (`competitions.status` + jogos reais):
   * 'upcoming' | 'ongoing' | 'finished'.
   */
  status: 'upcoming' | 'ongoing' | 'finished'
  /** True when the competition has knockout phases that decide on penalties. */
  has_penalty_phases?: boolean
}

export interface CreatedGroup {
  id: string
  name: string
  invite_code: string
}
