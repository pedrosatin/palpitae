/**
 * Application-level configuration sourced from Vite environment variables.
 *
 * Variables are injected at build time by Vite and must be prefixed with
 * VITE_ to be exposed to client code.
 *
 * VITE_API_URL  — base URL for the Palpitae API
 *                 Set in .env.development for local dev (http://localhost:8787)
 *                 Set in .env.production for deployed environments
 */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8787',
} as const
