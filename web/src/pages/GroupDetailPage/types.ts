import { type CompetitionType } from '../../components/StandingsTab'

export interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
  feature_flags?: {
    create_group?: boolean
  }
}

export interface GroupDetail {
  id: string
  name: string
  competition_id: string
  competition_name: string | null
  competition_type: CompetitionType | null
  is_admin: boolean
  invite_code: string
  created_at: string
  points_exact: number
  points_winner: number
  predictions_visibility: string
  member_count: number
  user_position: number
  user_points: number
  exact_hits: number
}

const TABS = ['predictions', 'standings', 'group-picks', 'leaderboard', 'members'] as const
export type Tab = (typeof TABS)[number]
export const DEFAULT_TAB: Tab = 'predictions'

export const TAB_LABELS: Record<Tab, string> = {
  predictions: 'Palpitar',
  standings: 'Tabela',
  'group-picks': 'Grupo',
  leaderboard: 'Ranking',
  members: 'Membros',
}

export function parseTab(value: string | null): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : DEFAULT_TAB
}
