export type Env = {
  DB: D1Database
  // Analytics Engine — opcional: não existe em dev local / testes (writeDataPoint
  // vira no-op via logEvent). Em produção o binding sempre está presente.
  AE?: AnalyticsEngineDataset
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
