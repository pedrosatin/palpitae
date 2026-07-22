import { renderHook } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useDocumentTitle } from './useDocumentTitle'

describe('useDocumentTitle', () => {
  const originalTitle = document.title

  beforeEach(() => {
    // Reset document.title to a known state before each test
    document.title = 'Original Title'
  })

  afterEach(() => {
    // Restore the very original title just in case
    document.title = originalTitle
  })

  it('should append the base title when a string is provided', () => {
    renderHook(() => useDocumentTitle('My Page'))
    expect(document.title).toBe('My Page | Palpitae')
  })

  it('should set only the base title when null is provided', () => {
    renderHook(() => useDocumentTitle(null))
    expect(document.title).toBe('Palpitae')
  })

  it('should set only the base title when undefined is provided', () => {
    renderHook(() => useDocumentTitle(undefined))
    expect(document.title).toBe('Palpitae')
  })

  it('should set only the base title when an empty string is provided', () => {
    renderHook(() => useDocumentTitle(''))
    expect(document.title).toBe('Palpitae')
  })

  it('should update the document title when the title prop changes', () => {
    const { rerender } = renderHook(
      ({ title }: { title: string | null | undefined }) => useDocumentTitle(title),
      {
        initialProps: { title: 'First Page' as string | null | undefined },
      },
    )

    expect(document.title).toBe('First Page | Palpitae')

    rerender({ title: 'Second Page' })

    expect(document.title).toBe('Second Page | Palpitae')
  })

  it('should restore the previous document title on unmount', () => {
    document.title = 'Previous View Title'

    const { unmount } = renderHook(() => useDocumentTitle('Current View'))

    expect(document.title).toBe('Current View | Palpitae')

    unmount()

    expect(document.title).toBe('Previous View Title')
  })
})
