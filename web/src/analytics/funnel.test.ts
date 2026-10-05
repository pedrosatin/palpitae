import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as ga from './ga'
import { markLoginStarted, trackJoinGroup, trackLoginIfPending, trackShareInvite } from './funnel'

vi.mock('./ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

beforeEach(() => {
  mockTrackEvent.mockClear()
  sessionStorage.clear()
})

describe('funnel events', () => {
  it('trackShareInvite sends share_invite with method and context', () => {
    trackShareInvite('whatsapp', 'create_group')
    expect(mockTrackEvent).toHaveBeenCalledWith('share_invite', {
      method: 'whatsapp',
      context: 'create_group',
    })
  })

  it('trackJoinGroup sends join_group with source and group id', () => {
    trackJoinGroup('convite_link', 'g1')
    expect(mockTrackEvent).toHaveBeenCalledWith('join_group', {
      source: 'convite_link',
      group_id: 'g1',
    })
  })

  it('tracks login only after a sign-in click and only once', () => {
    markLoginStarted()
    trackLoginIfPending(true)
    trackLoginIfPending(true)

    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith('login', { method: 'google' })
  })

  it('drops the pending mark without tracking when the session is missing', () => {
    markLoginStarted()
    trackLoginIfPending(false)
    trackLoginIfPending(true)

    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => markLoginStarted()).not.toThrow()
    expect(() => trackLoginIfPending(true)).not.toThrow()
    expect(mockTrackEvent).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
