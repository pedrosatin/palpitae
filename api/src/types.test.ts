import { describe, it, expectTypeOf } from 'vitest'
import type { Env, Variables, AppContext } from './types'

describe('types', () => {
  it('should define Env correctly', () => {
    expectTypeOf<Env>().toMatchTypeOf<{
      DB: any
      AE?: any
      EVENTS?: any
      CF_ACCOUNT_ID?: string
      AE_SQL_TOKEN?: string
      ADMIN_EMAIL?: string
      JWT_SECRET: string
      GOOGLE_CLIENT_ID: string
      GOOGLE_CLIENT_SECRET: string
      BASE_URL: string
      FRONTEND_URL: string
      FOOTBALL_API_KEY: string
      RESEND_API_KEY: string
    }>()
  })

  it('should define Variables correctly', () => {
    expectTypeOf<Variables>().toMatchTypeOf<{
      userId: string
      userEmail: string
    }>()
  })

  it('should define AppContext correctly', () => {
    expectTypeOf<AppContext>().toMatchTypeOf<{
      Bindings: Env
      Variables: Variables
    }>()
  })
})
