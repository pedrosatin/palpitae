import { type CompetitionType } from '../../components/StandingsTab'
import { hasShape, isRecord } from '../../lib/responseShape'

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
  /** Código canônico (`competitions.external_id`), ex. bra.camp.gaucho. */
  competition_code: string | null
  /**
   * O servidor deriva o valor dos jogos. Liga vira 'finished' quando não tem
   * jogo pendente. Copa precisa também da final encerrada.
   */
  competition_status?: 'upcoming' | 'ongoing' | 'finished' | null
  is_admin: boolean
  invite_code: string | null
  created_at: string
  points_exact: number
  points_penalty?: number
  points_classified?: number
  points_winner: number
  predictions_visibility: string
  member_count: number
  user_position: number | null
  user_points: number
  exact_hits: number
}

const GROUP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Diz se o segmento da URL tem o formato de id de grupo (UUID). Um id manipulado,
 * como `../auth/me`, nunca chega à montagem de URL da API.
 */
export function isGroupId(value: string | undefined): value is string {
  return value !== undefined && GROUP_ID_PATTERN.test(value)
}

/**
 * Lê `{ group }` de `GET /groups/:id`. Confere identidade, nome e os números que a
 * página usa sem proteção. Corpo fora do formato devolve null.
 */
export function parseGroupDetail(body: unknown): GroupDetail | null {
  const group = isRecord(body) ? body.group : null
  const ok = hasShape(group, {
    id: 'string',
    name: 'string',
    competition_id: 'string',
    is_admin: 'boolean',
    points_exact: 'number',
    points_winner: 'number',
    member_count: 'number',
  })
  return ok ? (group as unknown as GroupDetail) : null
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
