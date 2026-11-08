import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trackPageView } from './ga'
import { useGaPageView } from './useGaPageView'

vi.mock('./ga', () => ({ trackPageView: vi.fn() }))

const mockTrackPageView = vi.mocked(trackPageView)
const origin = window.location.origin
const firstId = '11111111-2222-4333-8444-555555555555'
const secondId = '66666666-7777-4888-9999-000000000000'

function setup(initialPath: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  )
  return renderHook(
    () => {
      useGaPageView()
      return useNavigate()
    },
    { wrapper },
  )
}

describe('useGaPageView', () => {
  beforeEach(() => mockTrackPageView.mockClear())

  it('does not send a page_view on the first render', () => {
    setup('/')
    expect(mockTrackPageView).not.toHaveBeenCalled()
  })

  it('sends a normalized page_view on internal navigation', () => {
    const { result } = setup('/')
    act(() => result.current(`/grupos/${firstId}?tab=ranking&convite=ABC`))
    expect(mockTrackPageView).toHaveBeenCalledExactlyOnceWith(
      { page_location: `${origin}/grupos/:id?tab=ranking`, page_title: 'Grupo | Palpitae' },
      `${origin}/`,
    )
  })

  it('ignores the round param being consumed from the URL', () => {
    const { result } = setup(`/grupos/${firstId}?rodada=21`)
    act(() => result.current(`/grupos/${firstId}`, { replace: true }))
    expect(mockTrackPageView).not.toHaveBeenCalled()
  })

  it('ignores changes in params that never reach GA', () => {
    const { result } = setup(`/grupos/${firstId}?convite=ABC`)
    act(() => result.current(`/grupos/${firstId}`))
    expect(mockTrackPageView).not.toHaveBeenCalled()
  })

  it('counts a tab change', () => {
    const { result } = setup(`/grupos/${firstId}`)
    act(() => result.current(`/grupos/${firstId}?tab=ranking`))
    expect(mockTrackPageView).toHaveBeenCalledTimes(1)
  })

  it('counts a move between two groups, whose normalized URL is the same', () => {
    const { result } = setup(`/grupos/${firstId}`)
    act(() => result.current(`/grupos/${secondId}`))
    expect(mockTrackPageView).toHaveBeenCalledExactlyOnceWith(
      { page_location: `${origin}/grupos/:id`, page_title: 'Grupo | Palpitae' },
      `${origin}/grupos/:id`,
    )
  })
})
