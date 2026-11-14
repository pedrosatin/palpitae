/**
 * Tradução dos event_type do Analytics Engine para linguagem de negócio.
 * O nome cru continua sendo a chave do esquema posicional em
 * docs/observability.md — a UI mostra o rótulo e mantém o cru no tooltip.
 */
const EVENT_LABELS: Record<string, string> = {
  // Negócio
  prediction_saved: 'Palpite salvo',
  group_created: 'Grupo criado',
  group_joined: 'Entrada em grupo',
  invite_opened: 'Abertura de convite',
  group_renamed: 'Grupo renomeado',
  group_deleted: 'Grupo excluído',
  member_removed: 'Membro removido',
  login_success: 'Login',
  login_failure: 'Falha de login',
  account_created: 'Conta criada',
  oauth_error: 'Erro de OAuth',
  matches_cache: 'Cache de jogos',
  // Saúde do cron / API Football
  poller_run: 'Poller de resultados',
  fixture_discovery_run: 'Descoberta de jogos',
  scheduled_unknown_cron: 'Cron sem rotina',
  scheduled_config_missing: 'Configuração ausente',
  // Poller, descoberta e sync manual cobrem football-data e ESPN.
  football_api_error: 'Erro de sync de provedor',
  match_results_fallback: 'Fallback de resultados (ESPN)',
  provider_http_attempt: 'Tentativa HTTP a provedor',
  sync_event_discarded: 'Evento descartado no sync',
  match_missing_from_feed: 'Jogo fora do calendário',
  match_scoring_error: 'Erro na pontuação',
  match_unscored: 'Jogo encerrado sem pontuação',
  radar_sync_run: 'Radar de competições',
  radar_sync_error: 'Erro do radar',
  security_storage_error: 'Falha de armazenamento de segurança',
  request_perf: 'Latência de request',
  // Notificações por e-mail
  email_reminder_sent: 'Lembrete enviado',
  email_reminder_failed: 'Falha no lembrete',
  cron_round_reminder: 'Cron de lembrete',
  cron_round_reminder_misconfig: 'Lembrete mal configurado',
  email_unsubscribed: 'Descadastro de e-mail',
  email_resubscribed: 'Recadastro de e-mail',
}

const PROVIDER_LABELS: Record<string, string> = {
  espn: 'ESPN',
  'football-data': 'football-data.org',
}

const HTTP_CONTEXT_LABELS: Record<string, string> = {
  poller: 'Poller de resultados',
  discovery: 'Descoberta de jogos',
  fallback: 'Fallback de resultados',
  sync: 'Sincronização manual',
}

/** Forma de chamada de `football_api_error` (blob2 do evento) → processo. */
const SYNC_ERROR_ORIGIN_LABELS: Record<string, string> = {
  poller: 'Poller de resultados',
  fixture_discovery: 'Descoberta de jogos',
  sync_endpoint: 'Sincronização manual',
}

/** Motivo de `sync_event_discarded` (blob4 do evento). */
const DISCARD_REASON_LABELS: Record<string, string> = {
  unknown_stage: 'Fase desconhecida',
  season_mismatch: 'Outra temporada',
  missing_competitor: 'Time ausente',
  invalid_event: 'Evento inválido',
}

/** Detalhe fixo do descarte; slug de fase e ano chegam crus. */
const DISCARD_DETAIL_LABELS: Record<string, string> = {
  tbd: 'time a definir',
  same_team: 'mesmo time dos dois lados',
  id: 'sem id',
  date: 'data inválida',
  competition: 'sem dados da partida',
}

/** Provedor legível; desconhecido volta cru. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

/** Processo que disparou a tentativa HTTP; desconhecido volta cru. */
export function httpContextLabel(context: string): string {
  return HTTP_CONTEXT_LABELS[context] ?? context
}

/** Origem de um erro de sync; desconhecida volta crua. */
export function syncErrorOriginLabel(origin: string): string {
  return SYNC_ERROR_ORIGIN_LABELS[origin] ?? origin
}

/** Motivo do descarte; desconhecido volta cru. */
export function discardReasonLabel(reason: string): string {
  return DISCARD_REASON_LABELS[reason] ?? reason
}

/** Detalhe do descarte legível; slug de fase e ano voltam crus. */
export function discardDetailLabel(detail: string): string {
  return DISCARD_DETAIL_LABELS[detail] ?? detail
}

/** Rótulo de negócio de um event_type; tipo desconhecido volta cru. */
export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type
}
