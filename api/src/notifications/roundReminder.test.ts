import type { D1Database } from '@cloudflare/workers-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendRoundReminders } from './roundReminder'

type ReminderRow = { competition_name: string; round: string; email: string }
type MatchRow = {
  competition_name: string
  round: string
  home_team: string
  away_team: string
  start_time: string
}

/**
 * Fake D1 that handles two sequential prepare() calls.
 * The first call returns user rows (reminder query).
 * The second call returns match rows (match-detail query).
 * The SQL of each call is captured for assertions.
 */
function buildFakeDb(userRows: ReminderRow[], matchRows: MatchRow[] = []) {
  let call = 0
  const captured: { sqls: string[] } = { sqls: [] }
  const db = {
    prepare(sql: string) {
      const rows = call === 0 ? userRows : matchRows
      captured.sqls.push(sql)
      call++
      const stmt = {
        bind() {
          return stmt
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: rows as unknown as T[] }
        },
      }
      return stmt
    },
    _captured: captured,
  }
  return db
}

describe('sendRoundReminders', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing when no round starts tomorrow', async () => {
    const db = buildFakeDb([])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('only selects the round\'s first match day in the user query', async () => {
    const db = buildFakeDb([])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(db._captured.sqls[0]).toContain("date(m.start_time) = date('now', '+1 day')")
    expect(db._captured.sqls[0]).toContain('MIN(date(m2.start_time))')
    expect(db._captured.sqls[0]).toContain("m.status = 'scheduled'")
  })

  it('fetches match details for rounds starting tomorrow', async () => {
    const db = buildFakeDb(
      [{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }],
      [],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(db._captured.sqls[1]).toContain('home_team')
    expect(db._captured.sqls[1]).toContain('away_team')
    expect(db._captured.sqls[1]).toContain('start_time')
    expect(db._captured.sqls[1]).toContain('ORDER BY m.start_time ASC')
  })

  it('sends one e-mail per member of a round', async () => {
    const db = buildFakeDb(
      [
        { competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' },
        { competition_name: 'Copa do Mundo', round: '2', email: 'b@x.com' },
      ],
      [],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(2)
    const recipients = vi
      .mocked(fetch)
      .mock.calls.map((c) => JSON.parse(c[1]!.body as string).to)
    expect(recipients.sort()).toEqual(['a@x.com', 'b@x.com'])
  })

  it('deduplicates a member who appears in multiple groups of the same round', async () => {
    const db = buildFakeDb([
      { competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' },
      { competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('includes match details in the e-mail body', async () => {
    const db = buildFakeDb(
      [{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }],
      [
        {
          competition_name: 'Copa do Mundo',
          round: '2',
          home_team: 'Brasil',
          away_team: 'Argentina',
          start_time: '2026-06-20T19:00:00Z',
        },
      ],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.html).toContain('Brasil')
    expect(body.html).toContain('Argentina')
  })

  it('still sends when a round has no match rows (graceful degradation)', async () => {
    const db = buildFakeDb(
      [{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }],
      [],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.html).toContain('Rodada 2')
  })

  it('authenticates and posts to the Resend API with the round in the subject', async () => {
    const db = buildFakeDb([
      { competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'secret-key')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
    const body = JSON.parse(init!.body as string)
    expect(body.subject).toContain('Rodada 2')
    expect(body.from).toContain('palpitae.com.br')
  })

  it('isolates a single send failure and still sends the rest', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const db = buildFakeDb([
      { competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' },
      { competition_name: 'Copa do Mundo', round: '2', email: 'b@x.com' },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
