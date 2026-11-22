export interface Match {
  id: string
  tie_role?: 'single' | 'leg1' | 'leg2'
  leg1_match_id?: string | null
  start_time: string
  status: 'scheduled' | 'live' | 'finished'
  postponed?: number | boolean
  locked_at?: string | null
  home_score: number | null
  away_score: number | null
  phase: string
  round: string
  round_label: string
  is_knockout?: boolean
  group_name: string | null
  home_team_id: string
  home_team_name: string
  home_team_short_name: string
  home_team_logo: string
  away_team_id: string
  away_team_name: string
  away_team_short_name: string
  away_team_logo: string
  decides_on_penalties?: boolean
  penalty_winner?: 'home' | 'away' | null
  home_penalty_goals?: number | null
  away_penalty_goals?: number | null
}

export interface Prediction {
  id: string
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  predicted_penalty_winner?: 'home' | 'away' | null
  points_awarded: number
  classified_points?: number
  predicted_classified?: 'home' | 'away' | null
  penalty_points?: number
  locked: boolean | 1 | 0
  updated_at: string
}

export const OUTCOMES = {
  home: { home: 1, away: 0, label: 'Casa' },
  draw: { home: 0, away: 0, label: 'Empate' },
  away: { home: 0, away: 1, label: 'Fora' },
} as const
export type Outcome = keyof typeof OUTCOMES

/** Sigla do time de um dos lados do jogo, ou `null` sem lado escolhido. */
export function teamShortName(
  match: Match,
  side: 'home' | 'away' | null | undefined,
): string | null {
  if (side === 'home') return match.home_team_short_name
  if (side === 'away') return match.away_team_short_name
  return null
}
