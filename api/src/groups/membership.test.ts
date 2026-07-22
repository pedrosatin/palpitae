import { describe, expect, it, vi, afterEach } from 'vitest'
import { getGroupMembership, getGroupMembershipTimed } from './membership'
import type { D1Database } from '@cloudflare/workers-types'

function createDbMock(firstResult: { role: string } | null) {
  const first = vi.fn().mockResolvedValue(firstResult)
  const bind = vi.fn().mockReturnValue({ first })
  const prepare = vi.fn().mockReturnValue({ bind })

  const db = { prepare }

  return { db: db as unknown as D1Database, prepare, bind, first }
}

describe('getGroupMembership', () => {
  it('returns a role when the member exists', async () => {
    const { db, prepare, bind, first } = createDbMock({ role: 'admin' })

    const result = await getGroupMembership(db, 'group-1', 'user-1')

    expect(result).toEqual({ role: 'admin' })
    expect(prepare).toHaveBeenCalledWith('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    expect(bind).toHaveBeenCalledWith('group-1', 'user-1')
    expect(first).toHaveBeenCalled()
  })

  it('returns null when the member does not exist', async () => {
    const { db, prepare, bind, first } = createDbMock(null)

    const result = await getGroupMembership(db, 'group-2', 'user-2')

    expect(result).toBeNull()
    expect(prepare).toHaveBeenCalledWith('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    expect(bind).toHaveBeenCalledWith('group-2', 'user-2')
    expect(first).toHaveBeenCalled()
  })
})

describe('getGroupMembershipTimed', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns membership data and calculates membershipMs duration', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'))

    const { db, first } = createDbMock({ role: 'member' })

    // Simulate database query taking 50ms
    first.mockImplementation(async () => {
      vi.advanceTimersByTime(50)
      return { role: 'member' }
    })

    const result = await getGroupMembershipTimed(db, 'group-1', 'user-1')

    expect(result.membership).toEqual({ role: 'member' })
    expect(result.membershipMs).toBe(50)
  })
})
