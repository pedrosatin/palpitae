import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { appQueryClient } from './lib/queryClient'

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null
}

beforeEach(() => {
  appQueryClient.clear()
})
