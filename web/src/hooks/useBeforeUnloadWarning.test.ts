import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useBeforeUnloadWarning } from './useBeforeUnloadWarning'

function fireBeforeUnload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useBeforeUnloadWarning', () => {
  it('só pede confirmação enquanto ativo', () => {
    const { rerender, unmount } = renderHook(({ active }) => useBeforeUnloadWarning(active), {
      initialProps: { active: false },
    })
    expect(fireBeforeUnload()).toBe(false)

    rerender({ active: true })
    expect(fireBeforeUnload()).toBe(true)

    rerender({ active: false })
    expect(fireBeforeUnload()).toBe(false)

    rerender({ active: true })
    unmount()
    expect(fireBeforeUnload()).toBe(false)
  })
})
