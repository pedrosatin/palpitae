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

// KPIs de negócio a partir do D1 (estado real da base) — GET /metrics/business.
export interface BusinessResponse {
  days: number
  usersTotal: number
  usersInGroup: number
  usersWhoPredicted: number
  usersCreatedInPeriod: number
  groupsCreatedInPeriod: number
  avgGroupsPerUser: number
  medianGroupsPerUser: number
  // Ausentes numa API anterior ao snapshot por campeonato — a página cai no
  // top 10 legado (`topCompetitions`) enquanto o deploy da API não chega.
  activeGroupDays?: number
  /** Limiar em horas de `overdue_no_score` nesta resposta (padrão 3). */
  overdueResultHours?: number
  /** Soma de `overdue_no_score` em todas as temporadas. */
  overdueTotal?: number
  /** Soma de `finished_unscored` em todas as temporadas. */
  finishedUnscoredTotal?: number
  competitions?: CompetitionSnapshot[]
  topCompetitions: { competition: string; groups: number }[]
}

// Uma linha por temporada cadastrada (inclusive sem grupo) — só agregados.
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
  // Saúde de resultados (D1). Ausentes numa API anterior a esse recorte —
  // a página mostra "—" / aviso em vez de tratar a falta como zero.
  overdue_no_score?: number
  finished_unscored?: number
}

export interface ArchiveResponse {
  // `events` = contagem real do dia (customMetadata do export); null em
  // arquivo antigo que o backfill de metadata ainda não alcançou.
  files: {
    key: string
    size: number
    uploaded: string
    events: number | null
  }[]
}

// Análise sob demanda do arquivo frio: agrega o CORPO dos NDJSON de um período
// (GET /metrics/archive/query). Único jeito de dissecar dados além da janela do AE.
export interface ArchiveQueryResponse {
  from: string
  to: string
  filesRead: number
  totalEvents: number
  byType: { event_type: string; count: number }[]
  byDay: { day: string; count: number }[]
  // Ausentes em API anterior ao teto de leitura. `truncated`: o teto de bytes
  // parou a leitura e só os dias de `daysRead` entraram.
  truncated?: boolean
  daysRead?: string[]
  malformedLines?: number
}

export type MetricsAlert = { key: string; label: string; level: 'warn' | 'danger' }

export type ArchiveFile = ArchiveResponse['files'][number]
