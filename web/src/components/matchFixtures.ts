import type { Match } from './MatchCard'

export function makeMatch(overrides: Partial<Match> = {}): Match {
  const status = overrides.status ?? 'scheduled'
  const defaultStartTime =
    status === 'scheduled'
      ? new Date(Date.now() + 3_600_000).toISOString()
      : new Date(Date.now() - 3_600_000).toISOString()
  return {
    id: 'm1',
    start_time: defaultStartTime,
    status,
    home_score: null,
    away_score: null,
    phase: 'group',
    round: '1',
    group_name: null,
    home_team_id: 'ht-1',
    home_team_name: 'Brasil',
    home_team_short_name: 'BRA',
    home_team_logo: '/bra.png',
    away_team_id: 'at-1',
    away_team_name: 'Argentina',
    away_team_short_name: 'ARG',
    away_team_logo: '/arg.png',
    ...overrides,
  }
}
