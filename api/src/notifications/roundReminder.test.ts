import type { D1Database } from '@cloudflare/workers-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatBRT, sendRoundReminders } from './roundReminder'

type ReminderRow = {
  competition_id?: string
  competition_name: string
  round: string
  email: string
  user_id?: string
  group_id?: string
  group_name?: string
}
type MatchRow = {
  competition_id?: string
  competition_name: string
  round: string
  home_team: string
  away_team: string
  home_logo?: string | null
  away_logo?: string | null
  start_time: string
}

/**
 * Fake D1 that routes each prepare() call by the SQL itself (match by substring),
 * not by call order — so reordering or adding queries can't silently feed the
 * wrong rows to a test. The match-detail query is the one selecting `home_team`;
 * everything else is the user/reminder query.
 */
function buildFakeDb(userRows: ReminderRow[], matchRows: MatchRow[] = []) {
  const captured: { sqls: string[] } = { sqls: [] }
  const db = {
    prepare(sql: string) {
      captured.sqls.push(sql)
      // Default user_id to the e-mail so the source always has a stable id to hash.
      const normalizedUsers = userRows.map((r) => ({
        ...r,
        competition_id: r.competition_id ?? r.competition_name,
        user_id: r.user_id ?? r.email,
        group_id: r.group_id ?? 'default-group',
        group_name: r.group_name ?? 'Grupo',
      }))
      const normalizedMatches = matchRows.map((r) => ({
        ...r,
        competition_id: r.competition_id ?? r.competition_name,
      }))
      const rows = sql.includes('home_team') ? normalizedMatches : normalizedUsers
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

/** Returns the SQL of the user/reminder query (the one without home_team). */
function userSql(db: ReturnType<typeof buildFakeDb>): string {
  return db._captured.sqls.find((s) => !s.includes('home_team')) ?? ''
}

/** Returns the SQL of the match-detail query. */
function matchSql(db: ReturnType<typeof buildFakeDb>): string {
  return db._captured.sqls.find((s) => s.includes('home_team')) ?? ''
}

describe('sendRoundReminders', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing when no round starts today', async () => {
    const db = buildFakeDb([])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).not.toHaveBeenCalled()
  })

  it("only selects the round's first match day in the user query", async () => {
    const db = buildFakeDb([])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(userSql(db)).toContain("date(m.start_time, '-3 hours') = date('now', '-3 hours')")
    expect(userSql(db)).toContain("MIN(date(m2.start_time, '-3 hours'))")
    expect(userSql(db)).toContain("m.status = 'scheduled'")
  })

  it('fetches match details for rounds starting today', async () => {
    const db = buildFakeDb(
      [{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }],
      [],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(matchSql(db)).toContain('home_team')
    expect(matchSql(db)).toContain('away_team')
    expect(matchSql(db)).toContain('start_time')
    expect(matchSql(db)).toContain('ORDER BY m.start_time ASC')
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
    const recipients = vi.mocked(fetch).mock.calls.map((c) => JSON.parse(c[1]!.body as string).to)
    expect(recipients.sort()).toEqual(['a@x.com', 'b@x.com'])
  })

  it('sends one e-mail with per-group CTAs when a member is in multiple groups of the same round', async () => {
    const db = buildFakeDb([
      {
        competition_name: 'Copa do Mundo',
        round: '2',
        email: 'a@x.com',
        group_id: 'g1',
        group_name: 'Grupo A',
      },
      {
        competition_name: 'Copa do Mundo',
        round: '2',
        email: 'a@x.com',
        group_id: 'g2',
        group_name: 'Grupo B',
      },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(1)
    const html = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).html
    expect(html).toContain('/grupos/g1')
    expect(html).toContain('/grupos/g2')
    expect(html).toContain('Grupo A')
    expect(html).toContain('Grupo B')
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

  it('translates a knockout stage to its display label in subject and body', async () => {
    const db = buildFakeDb([
      { competition_name: 'Copa do Mundo', round: 'LAST_32', email: 'a@x.com' },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.subject).toContain('Rodada de 32')
    expect(body.subject).not.toContain('LAST_32')
    expect(body.html).toContain('Rodada de 32')
    expect(body.html).not.toContain('LAST_32')
    expect(body.text).toContain('Rodada de 32')
  })

  it('authenticates and posts to the Resend API with the round in the subject', async () => {
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(db as unknown as D1Database, 'secret-key')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
    const body = JSON.parse(init!.body as string)
    expect(body.subject).toContain('Rodada 2')
    expect(body.from).toContain('palpitae.com.br')
  })

  it('isolates a single permanent send failure and still sends the rest', async () => {
    // 422 is permanent (bad address etc.) — fail fast, no retry, isolate it.
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('boom', { status: 422 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const db = buildFakeDb([
      { competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' },
      { competition_name: 'Copa do Mundo', round: '2', email: 'b@x.com' },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries a 429 (honouring Retry-After) and eventually succeeds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after MAX_SEND_ATTEMPTS on persistent rate limiting', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('rate', { status: 429, headers: { 'Retry-After': '0' } }),
    )
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does nothing and reports zero when the Resend key is missing', async () => {
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(db as unknown as D1Database, '')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('excludes users who already predicted (NOT EXISTS on predictions)', async () => {
    const db = buildFakeDb([])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(userSql(db)).toContain('NOT EXISTS')
    expect(userSql(db)).toContain('FROM predictions p')
    expect(userSql(db)).toContain('p.user_id  = u.id')
    expect(userSql(db)).toContain('pm.round = m.round')
  })

  it('sends independent e-mails for multiple competitions in the same run', async () => {
    const db = buildFakeDb([
      { competition_name: 'Copa do Brasil', round: '3', email: 'a@x.com' },
      { competition_name: 'Libertadores', round: '5', email: 'a@x.com' },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    // Same user, two distinct (competition, round) groups → two e-mails.
    expect(fetch).toHaveBeenCalledTimes(2)
    const subjects = vi
      .mocked(fetch)
      .mock.calls.map((c) => JSON.parse(c[1]!.body as string).subject)
    expect(subjects.some((s: string) => s.includes('Rodada 3'))).toBe(true)
    expect(subjects.some((s: string) => s.includes('Rodada 5'))).toBe(true)
  })

  it('escapes HTML-significant characters from the database', async () => {
    const db = buildFakeDb(
      [
        {
          competition_name: 'Copa & Cia',
          round: 'Quartas "A"',
          email: 'a@x.com',
        },
      ],
      [
        {
          competition_name: 'Copa & Cia',
          round: 'Quartas "A"',
          home_team: 'Time <b>',
          away_team: "O'Higgins",
          start_time: '2026-06-20T19:00:00Z',
        },
      ],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    const html = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).html
    expect(html).toContain('Copa &amp; Cia')
    expect(html).toContain('Quartas &quot;A&quot;')
    expect(html).toContain('Time &lt;b&gt;')
    expect(html).toContain('O&#39;Higgins')
    expect(html).not.toContain('Time <b>')
  })

  it('includes a plain-text fallback alongside the HTML', async () => {
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
    expect(body.text).toContain('Brasil vs Argentina')
    expect(body.text).toContain('Rodada 2')
    expect(body.text).not.toContain('<')
  })

  it('produces a full HTML document (DOCTYPE/head/body)', async () => {
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    const html = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).html
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<head>')
    expect(html).toContain('<body')
  })

  it('renders team crests as <img> with the logo url and name as alt', async () => {
    const db = buildFakeDb(
      [{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }],
      [
        {
          competition_name: 'Copa do Mundo',
          round: '2',
          home_team: 'Brasil',
          away_team: 'Argentina',
          home_logo: 'https://crests.example/br.png',
          away_logo: 'https://crests.example/ar.svg',
          start_time: '2026-06-20T19:00:00Z',
        },
      ],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    const html = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).html
    expect(html).toContain('src="https://crests.example/br.png"')
    expect(html).toContain('src="https://crests.example/ar.svg"')
    expect(html).toContain('alt="Brasil"')
  })

  it('omits the crest <img> when a team has no logo', async () => {
    const db = buildFakeDb(
      [{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }],
      [
        {
          competition_name: 'Copa do Mundo',
          round: '2',
          home_team: 'Brasil',
          away_team: 'Argentina',
          home_logo: null,
          away_logo: null,
          start_time: '2026-06-20T19:00:00Z',
        },
      ],
    )

    await sendRoundReminders(db as unknown as D1Database, 'key')

    const html = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).html
    // No <img> at all: header logo dropped for deliverability, and no crest <img>
    // since both logo_url are null. Fewer images = less "Promotions" signal.
    const imgTags = [...html.matchAll(/<img[^>]+>/g)].map((m: RegExpMatchArray) => m[0])
    expect(imgTags.length).toBe(0)
    expect(html).toContain('Brasil')
  })

  it('uses the provided appUrl in the CTA link and text body', async () => {
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(db as unknown as D1Database, 'key', undefined, 'http://localhost:5173')

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.html).toContain('http://localhost:5173/grupos/')
    expect(body.text).toContain('http://localhost:5173/grupos/')
  })

  it('does not append UTM params to links (they flag the mail as Promotions)', async () => {
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(
      db as unknown as D1Database,
      'key',
      undefined,
      'https://palpitae.com.br',
    )

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.html).not.toContain('utm_')
    expect(body.text).not.toContain('utm_')
  })

  it('fires on the first match day of the round only (min-date guard)', async () => {
    const db = buildFakeDb([])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    // The user query must only fire on the round's first match day (BRT-adjusted),
    // preventing duplicate notifications mid-round.
    expect(userSql(db)).toContain('MIN(date(m2.start_time')
    expect(userSql(db)).toContain("date('now', '-3 hours')")
  })

  it('suppresses opted-out users via the email_unsubscribed_at gate', async () => {
    const db = buildFakeDb([])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(userSql(db)).toContain('u.email_unsubscribed_at IS NULL')
  })

  it('adds a per-user unsubscribe link, headers and one-click POST when configured', async () => {
    const db = buildFakeDb([
      {
        competition_name: 'Copa do Mundo',
        round: '2',
        email: 'a@x.com',
        user_id: 'user-99',
      },
    ])

    await sendRoundReminders(
      db as unknown as D1Database,
      'key',
      undefined,
      'https://palpitae.com.br',
      {
        secret: 'unsub-secret',
        apiBaseUrl: 'https://api.palpitae.com.br/',
      },
    )

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    const unsubBase = 'https://api.palpitae.com.br/notifications/unsubscribe?token='
    expect(body.html).toContain('Cancelar inscrição')
    expect(body.html).toContain(unsubBase)
    expect(body.text).toContain(unsubBase)
    expect(body.headers['List-Unsubscribe']).toContain(`<${unsubBase}`)
    expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('omits the unsubscribe link and headers when no unsub config is given', async () => {
    const db = buildFakeDb([{ competition_name: 'Copa do Mundo', round: '2', email: 'a@x.com' }])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.html).not.toContain('Cancelar inscrição')
    expect(body.headers).toBeUndefined()
  })

  it('treats same-named competitions as separate when they have different IDs', async () => {
    // Same competition name, different IDs — old string key would collapse them into
    // one group, so the same user would only get one e-mail instead of two.
    const db = buildFakeDb([
      {
        competition_id: 'comp-1',
        competition_name: 'Liga',
        round: '3',
        email: 'a@x.com',
      },
      {
        competition_id: 'comp-2',
        competition_name: 'Liga',
        round: '3',
        email: 'a@x.com',
      },
    ])

    await sendRoundReminders(db as unknown as D1Database, 'key')

    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('formatBRT', () => {
  it('renders a UTC instant in São Paulo time (UTC-3)', () => {
    // 22:00Z → 19:00 BRT.
    const out = formatBRT('2026-06-20T22:00:00Z')
    // Node < 20 often uses '.' instead of ',' or omits the comma depending on ICU data.
    // The main thing is verifying we got the correct components, like the time and date.
    expect(out).toMatch(/sáb.*20\/06.*19:00/)
  })

  it('correctly shifts backwards across day boundaries', () => {
    // 01:00Z on Jun 21st → 22:00 BRT on Jun 20th.
    const out = formatBRT('2026-06-21T01:00:00Z')
    expect(out).toMatch(/sáb.*20\/06.*22:00/)
  })

  it('uses two digits for days, months, hours, and minutes', () => {
    // 06:05Z → 03:05 BRT.
    const out = formatBRT('2026-01-05T06:05:00Z')
    expect(out).toMatch(/seg.*05\/01.*03:05/)
  })

  it('handles leap years correctly', () => {
    // 15:30Z → 12:30 BRT.
    const out = formatBRT('2024-02-29T15:30:00Z')
    expect(out).toMatch(/qui.*29\/02.*12:30/)
  })

  it('throws an error for an invalid date string', () => {
    expect(() => formatBRT('not-a-date')).toThrow(RangeError)
  })
})
