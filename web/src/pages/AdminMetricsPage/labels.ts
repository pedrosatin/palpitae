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
  group_renamed: 'Grupo renomeado',
  group_deleted: 'Grupo excluído',
  member_removed: 'Membro removido',
  login_success: 'Login',
  login_failure: 'Falha de login',
  oauth_error: 'Erro de OAuth',
  matches_cache: 'Cache de jogos',
  // Saúde do cron / API Football
  poller_run: 'Poller de resultados',
  fixture_discovery_run: 'Descoberta de jogos',
  football_api_error: 'Erro da API Football',
  request_perf: 'Latência de request',
  // Notificações por e-mail
  email_reminder_sent: 'Lembrete enviado',
  cron_round_reminder: 'Cron de lembrete',
  cron_round_reminder_misconfig: 'Lembrete mal configurado',
  email_unsubscribed: 'Descadastro de e-mail',
  email_resubscribed: 'Recadastro de e-mail',
}

/** Rótulo de negócio de um event_type; tipo desconhecido volta cru. */
export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type
}
