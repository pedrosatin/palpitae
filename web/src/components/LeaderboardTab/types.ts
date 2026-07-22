export interface Member {
  user_id: string
  display_name: string
  avatar_url: string | null
  role: string
  joined_at: string
  total_points: number
  exact_hits: number
}

export interface UserPrediction {
  match_id: string
  predicted_home_score: number | null
  predicted_away_score: number | null
  points_awarded: number | null
  match_status: string
  match_start_time: string
  home_score: number | null
  away_score: number | null
  round: string
  round_label: string
  group_name: string | null
  home_team_name: string
  home_team_short_name: string
  home_team_logo: string
  away_team_name: string
  away_team_short_name: string
  away_team_logo: string
}
