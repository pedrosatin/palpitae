export type Env = {
  DB: D1Database
  // Analytics Engine — opcional: não existe em dev local / testes (writeDataPoint
  // vira no-op via logEvent). Em produção o binding sempre está presente.
  AE?: AnalyticsEngineDataset
  // Cold path (Fase 4) — arquivo ilimitado de eventos em R2. Opcionais: o export
  // diário vira no-op se faltar qualquer um. Ver docs/observability.md.
  EVENTS?: R2Bucket // bucket R2 onde o NDJSON diário é gravado
  CF_ACCOUNT_ID?: string // conta Cloudflare (URL da SQL API do Analytics Engine)
  AE_SQL_TOKEN?: string // token com permissão Account Analytics:Read
  JWT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  BASE_URL: string
  FRONTEND_URL: string
  FOOTBALL_API_KEY: string
}

export type Variables = {
  userId: string
  userEmail: string
}

export type AppContext = {
  Bindings: Env
  Variables: Variables
}
