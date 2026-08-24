import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { useGroupTabs } from './hooks'
import { GroupDetail } from './types'
import React from 'react'
import { trackEvent } from '../../analytics/ga'

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

const mockGroup: GroupDetail = {
  id: 'g1',
  name: 'Test Group',
  competition_id: 'c1',
  competition_name: 'Test Comp',
  competition_type: 'league',
  is_admin: true,
  invite_code: 'TEST',
  created_at: '2023-01-01',
  points_exact: 5,
  points_winner: 3,
  predictions_visibility: 'always',
  member_count: 1,
  user_position: 1,
  user_points: 0,
  exact_hits: 0,
}

describe('useGroupTabs', () => {
  it('initializes with default tab if none in URL', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    })

    expect(result.current.activeTab).toBe('predictions')
    expect(result.current.showStandings).toBe(true)
  })

  it('initializes with tab from URL', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/?tab=leaderboard'] }, children),
    })

    expect(result.current.activeTab).toBe('leaderboard')
  })

  it('falls back to default if standings tab is requested but group competition is not league', () => {
    const nonLeagueGroup = { ...mockGroup, competition_type: 'cup' as any }
    const { result } = renderHook(() => useGroupTabs(nonLeagueGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/?tab=standings'] }, children),
    })

    expect(result.current.activeTab).toBe('predictions')
    expect(result.current.showStandings).toBe(false)
  })

  it('setActiveTab updates URL correctly', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    })

    act(() => {
      result.current.handleTabClick({ preventDefault: vi.fn() } as any, 'leaderboard')
    })

    expect(result.current.activeTab).toBe('leaderboard')
    expect(trackEvent).toHaveBeenCalledWith('click_group_detail_tab', { tab: 'leaderboard' })
  })

  it('tabHref computes correct links', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/?tab=leaderboard'] }, children),
    })

    expect(result.current.tabHref('standings')).toBe('?tab=standings')
    expect(result.current.tabHref('predictions')).toBe('.') // DEFAULT_TAB deletes the tab param
  })

  it('does not prevent default or call setActiveTab if modifier key is pressed', () => {
    const { result } = renderHook(() => useGroupTabs(mockGroup), {
      wrapper: ({ children }) =>
        React.createElement(MemoryRouter, { initialEntries: ['/'] }, children),
    })

    const preventDefault = vi.fn()

    act(() => {
      result.current.handleTabClick({ preventDefault, ctrlKey: true } as any, 'leaderboard')
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(result.current.activeTab).toBe('predictions') // Hasn't changed
  })
})
