import { fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOutsideClick } from './useOutsideClick'

describe('useOutsideClick', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function createElements() {
    const inside = document.createElement('div')
    const child = document.createElement('span')
    const outside = document.createElement('div')
    inside.appendChild(child)
    document.body.append(inside, outside)
    return { inside, child, outside }
  }

  it('chama onOutside ao clicar fora enquanto ativo', () => {
    const { inside, outside } = createElements()
    const onOutside = vi.fn()
    const ref = { current: inside }

    renderHook(() => useOutsideClick(ref, true, onOutside))

    fireEvent.mouseDown(outside)
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it('ignora cliques dentro do elemento ou quando inativo', () => {
    const { inside, child, outside } = createElements()
    const onOutside = vi.fn()
    const ref = { current: inside }

    const { rerender } = renderHook(({ active }) => useOutsideClick(ref, active, onOutside), {
      initialProps: { active: true },
    })

    fireEvent.mouseDown(inside)
    fireEvent.mouseDown(child)
    expect(onOutside).not.toHaveBeenCalled()

    rerender({ active: false })
    fireEvent.mouseDown(outside)
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('remove o listener ao desmontar', () => {
    const { inside, outside } = createElements()
    const onOutside = vi.fn()
    const ref = { current: inside }

    const { unmount } = renderHook(() => useOutsideClick(ref, true, onOutside))
    unmount()

    fireEvent.mouseDown(outside)
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('fecha com Escape apenas quando closeOnEscape está ativo', () => {
    const { inside } = createElements()
    const onOutside = vi.fn()
    const ref = { current: inside }

    const { rerender, unmount } = renderHook(
      ({ closeOnEscape }) => useOutsideClick(ref, true, onOutside, { closeOnEscape }),
      { initialProps: { closeOnEscape: false } },
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOutside).not.toHaveBeenCalled()

    rerender({ closeOnEscape: true })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onOutside).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOutside).toHaveBeenCalledTimes(1)

    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOutside).toHaveBeenCalledTimes(1)
  })
})
