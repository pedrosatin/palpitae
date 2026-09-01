import { describe, it, expectTypeOf } from 'vitest'
import { Member, UserPrediction } from './types'

describe('LeaderboardTab types', () => {
  it('Member interface should match exact structure', () => {
    expectTypeOf<Member>().toMatchTypeOf<{
      user_id: string
      display_name: string
      avatar_url: string | null
      role: string
      joined_at: string
      total_points: number
      exact_hits: number
    }>()

    expectTypeOf<{
      user_id: string
      display_name: string
      avatar_url: string | null
      role: string
      joined_at: string
      total_points: number
      exact_hits: number
    }>().toMatchTypeOf<Member>()
  })

  it('UserPrediction interface should match exact structure', () => {
    expectTypeOf<UserPrediction>().toMatchTypeOf<{
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
    }>()

    expectTypeOf<{
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
    }>().toMatchTypeOf<UserPrediction>()
  })
})
