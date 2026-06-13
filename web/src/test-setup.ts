import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { invalidateApiCache } from './lib/api-cache'

beforeEach(() => {
  invalidateApiCache()
})
