import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { invalidateApiCache } from './lib/api-cache'
import { appQueryClient } from './lib/queryClient'

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null
}

beforeEach(() => {
  invalidateApiCache()
  appQueryClient.clear()
})
