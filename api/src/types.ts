import type { JwtPayload } from './auth/jwt'

export type Env = {
  DB: D1Database
  // Analytics Engine opcional em dev local e testes. Em produção o binding está presente.
  AE?: AnalyticsEngineDataset
  // Arquivo de eventos em R2. O export diário não executa se faltar qualquer binding abaixo.
  EVENTS?: R2Bucket
  CF_ACCOUNT_ID?: string
  AE_SQL_TOKEN?: string
  // E-mail do administrador autorizado no painel de métricas e na gestão de competições.
  ADMIN_EMAIL?: string
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
  // Segredo compartilhado com o proxy do Pages para confiar no IP repassado.
  PROXY_SHARED_SECRET?: string
}

// Resultado da verificação do cookie de sessão guardado no contexto da requisição.
export type SessionState = { payload: JwtPayload } | { error: unknown }

export type Variables = {
  userId: string
  userEmail: string
  session?: SessionState
}

export type AppContext = {
  Bindings: Env
  Variables: Variables
}
