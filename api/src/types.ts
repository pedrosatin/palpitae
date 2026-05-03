export type Env = {
  DB: D1Database
  JWT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  BASE_URL: string
  FRONTEND_URL: string
}

export type Variables = {
  userId: string
}

export type AppContext = {
  Bindings: Env
  Variables: Variables
}
