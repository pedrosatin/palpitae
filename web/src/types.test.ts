import { describe, it, expectTypeOf } from 'vitest'
import { User } from './types'

describe('types.ts', () => {
  it('User interface should match exact structure', () => {
    expectTypeOf<User>().toEqualTypeOf<{
      id: string
      email: string
      nickname?: string
      avatar_url?: string
      feature_flags?: {
        create_group?: boolean
      }
    }>()
  })
})
