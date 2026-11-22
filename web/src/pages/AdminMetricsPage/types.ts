export interface OverviewResponse {
  days: number
  totals: { event_type: string; count: string | number }[]
  daily: { day: string; event_type: string; count: string | number }[]
  poller: {
    status: string
    runs: string | number
    avg_duration_ms: string | number
    max_duration_ms: string | number
  }[]
  predictions: { active_users: string | number; total: string | number }
  cache: { result: string; count: string | number }[]
  loginFailures: { reason: string; count: string | number }[]
  apiCallsDaily: { day: string; api_calls: string | number }[]
  recentErrors: {
    timestamp: string
    event_type: string
    blob2: string
    blob3: string
    blob4: string
  }[]
  sampling: { avg_sample_interval: string | number }
  whales: { user_hash: string; predictions: string | number }[]
  lastRuns: { event_type: string; last_run: string }[]
  emailHealth: {
    rounds: string | number
    sent: string | number
    failed: string | number
  }
  latency: {
    route: string
    requests: string | number
    avg_ms: string | number
    max_ms: string | number
    avg_db_ms: string | number
  }[]
  predictionsDaily: { day: string; users: string | number }[]
}

export interface BusinessResponse {
  days: number
  usersTotal: number
  usersInGroup: number
  usersWhoPredicted: number
  usersCreatedInPeriod: number
  groupsCreatedInPeriod: number
  avgGroupsPerUser: number
  medianGroupsPerUser: number
  activeGroupDays?: number
  overdueResultHours?: number
  overdueTotal?: number
  finishedUnscoredTotal?: number
  competitions?: CompetitionSnapshot[]
  topCompetitions: { competition: string; groups: number }[]
}

export interface CompetitionSnapshot {
  id: string
  name: string
  slug: string
  season: string | null
  provider: string | null
  visibility: string
  status: string
  groups_current: number
  members: number
  active_groups_14d: number
  overdue_no_score?: number
  finished_unscored?: number
}

export interface ArchiveResponse {
  files: {
    key: string
    size: number
    uploaded: string
    events: number | null
  }[]
}

export interface ArchiveQueryResponse {
  from: string
  to: string
  filesRead: number
  totalEvents: number
  byType: { event_type: string; count: number }[]
  byDay: { day: string; count: number }[]
  truncated?: boolean
  daysRead?: string[]
  malformedLines?: number
}

export type MetricsAlert = { key: string; label: string; level: 'warn' | 'danger' }

export type ArchiveFile = ArchiveResponse['files'][number]
