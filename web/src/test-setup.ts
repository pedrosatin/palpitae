import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { invalidateApiCache } from './lib/api-cache'

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null
}

beforeEach(() => {
  invalidateApiCache()
})
