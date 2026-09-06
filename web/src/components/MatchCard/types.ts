export interface Match {
  id: string
  start_time: string
  status: 'scheduled' | 'finished'
  /**
   * Jogo adiado pelo provider. O `start_time` continua sendo o horário original
   * (que já passou), então o card não pode se guiar só pela data — sem essa flag
   * ele mostraria "bloqueado / aguardando resultado" para sempre.
   */
  postponed?: number | boolean
  home_score: number | null
  away_score: number | null
  phase: string
  round: string
  /** Server-derived display label for the round (e.g. "Rodada 1", "Oitavas de final"). */
  round_label: string
  group_name: string | null
  home_team_id: string
  home_team_name: string
  home_team_short_name: string
  home_team_logo: string
  away_team_id: string
  away_team_name: string
  away_team_short_name: string
  away_team_logo: string
  /** Server-derived: this match decides on penalties in a single game. */
  decides_on_penalties?: boolean
  /** Actual shootout result (only set once a finished match went to penalties). */
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
