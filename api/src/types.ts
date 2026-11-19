import type { AccountIdentity } from './auth/permissions'
import type { SessionPayload } from './auth/session'
import type { DailyKeys } from './security/limits'

export type Env = {
  DB: D1Database
  // Analytics Engine opcional em dev local e testes. Em produção o binding está presente.
  AE?: AnalyticsEngineDataset
  // Arquivo de eventos em R2. O export diário não executa se faltar qualquer binding abaixo.
  EVENTS?: R2Bucket
  CF_ACCOUNT_ID?: string
  AE_SQL_TOKEN?: string
  // Token só de leitura (Account Analytics:Read) da API GraphQL de analytics. Com o
  // CF_ACCOUNT_ID, mede o uso diário das cotas do plano Free. Ver docs/observability.md.
  CF_ANALYTICS_TOKEN?: string
  // E-mail do administrador autorizado no painel de métricas e na gestão de competições.
  ADMIN_EMAIL?: string
  // `sub` do Google do administrador (`users.provider_id` com `provider = 'google'`).
  // Definido, o papel de admin exige também esse `sub`, e um e-mail reciclado não o herda.
  // Vazio ou ausente, vale só o e-mail. Ver docs/security.md.
  ADMIN_GOOGLE_SUB?: string
  // Lista separada por vírgula de e-mails convidados para testar competições em modo piloto.
  PILOT_EMAILS?: string
  JWT_SECRET: string
  // Assina os links de descadastro; não acompanha a rotação do JWT_SECRET. Sem ele,
  // o link é assinado com o JWT_SECRET. Ver docs/security.md.
  UNSUBSCRIBE_SECRET?: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  BASE_URL: string
  FRONTEND_URL: string
  FOOTBALL_API_KEY: string
  RESEND_API_KEY: string
  // Teto de chamadas ao Resend por execução do lembrete diário. Padrão 45 (plano Free).
  REMINDER_FETCH_BUDGET?: string
  // Limiar em horas para resultado atrasado sem placar (padrão 3). Ver resultOverdue.ts.
  RESULT_OVERDUE_HOURS?: string
  // Liga o e-mail de alerta de resultado atrasado ao ADMIN_EMAIL via Resend (`1`/`true`).
  RESULT_OVERDUE_ALERT?: string
  // Cooldown em horas entre e-mails do mesmo alerta (padrão 6).
  RESULT_OVERDUE_ALERT_COOLDOWN_HOURS?: string
  // Orçamento diário de linhas do D1 por usuário (ADR-022). Padrões 250000 lidas e
  // 5000 escritas. Valor que não seja inteiro positivo volta ao padrão.
  D1_DAILY_ROWS_READ_PER_USER?: string
  D1_DAILY_ROWS_WRITTEN_PER_USER?: string
  // Segredo compartilhado com o proxy do Pages para confiar no IP repassado.
  PROXY_SHARED_SECRET?: string
  // CF-Worker que a Cloudflare preenche no proxy do Pages, no formato `<projeto>.pages.dev`.
  FRONTEND_WORKER_ZONE?: string
}

// Resultado da verificação do cookie de sessão guardado no contexto da requisição.
export type SessionState = { payload: SessionPayload } | { error: unknown }

export type Variables = {
  userId: string
  userEmail: string
  // E-mail e `sub` do Google da conta, como o D1 os grava. Base de admin e de piloto.
  userIdentity: AccountIdentity
  session?: SessionState
  limiterDb?: D1Database
  dailyKeys?: DailyKeys
}

export type AppContext = {
  Bindings: Env
  Variables: Variables
}
