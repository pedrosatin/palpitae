export type Round =
  | 'LAST_32'
  | 'LAST_16'
  | 'QUARTER_FINALS'
  | 'SEMI_FINALS'
  | 'FINAL'
  | 'THIRD_PLACE'

export interface Team {
  id: string
  name: string
  short_name: string
  logo_url: string | null
}

export interface BracketMatch {
  id: string
  start_time: string
  status: 'scheduled' | 'live' | 'finished'
  home_score: number | null
  away_score: number | null
  home_team_id: string | null
  home_team_name: string | null
  home_team_short: string | null
  home_team_logo: string | null
  away_team_id: string | null
  away_team_name: string | null
  away_team_short: string | null
  away_team_logo: string | null
}

export interface MemberPick {
  user_id: string
  user_display: string
  team_id: string
  team_name: string
  team_short: string
  team_logo: string | null
}

export type Pick = {
  team_id: string
  team_name: string
  team_short: string
  team_logo: string | null
}

export interface SlotData {
  position: number
  match: BracketMatch | null
  locked: boolean
  my_pick: Pick | null
  members_picks: MemberPick[]
}

/** What teams are available for a given slot */
export type AvailableTeamsResult =
  | { kind: 'match'; teams: Team[] } //              duel: scheduled match with both teams known
  | { kind: 'cascade'; teams: Team[] } //            duel: derived from previous round picks
  | { kind: 'waiting' } //                           prev round not filled yet
  | { kind: 'all'; grouped: Map<string, Team[]> } // R32 TBD: all teams grouped by group letter

export interface BracketData {
  teams: Team[]
  team_groups: Record<string, string> // teamId → group letter (e.g. 'A')
  rounds: Partial<Record<Round, SlotData[]>>
  round_points: Record<Round, number>
}
