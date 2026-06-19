import type { D1Database } from '@cloudflare/workers-types'
import { sendEmail } from './email'

const APP_URL = 'https://palpitae.com.br'

type ReminderRow = {
  competition_name: string
  round: string
  email: string
}

type MatchRow = {
  competition_name: string
  round: string
  home_team: string
  away_team: string
  start_time: string
}

type MatchInfo = {
  home: string
  away: string
  time: string
}

type RoundGroup = {
  competitionName: string
  round: string
  emails: string[]
  matches: MatchInfo[]
}

/**
 * Sends an e-mail reminder to every group member whose competition has a round
 * starting tomorrow. Designed to run once a day from a daily Cron Trigger.
 *
 * Only fires on the round's FIRST match day: the WHERE clause requires tomorrow
 * to equal the earliest scheduled match date of that (competition, round). This
 * prevents re-notifying mid-round when a round spans several days. Combined with
 * the once-a-day cron, no per-send dedupe table is needed.
 *
 * start_time is stored as ISO 8601 with T/Z (e.g. "2026-06-16T22:00:00Z"), which
 * SQLite's date() parses correctly. All date math here is in UTC.
 */
export async function sendRoundReminders(db: D1Database, resendApiKey: string): Promise<void> {
  const startedAt = Date.now()

  // Query 1: which users need to be notified?
  const userRows = await db
    .prepare(
      `SELECT DISTINCT
         c.name  AS competition_name,
         m.round AS round,
         u.email AS email
       FROM matches m
       JOIN competitions c   ON c.id = m.competition_id
       JOIN groups g         ON g.competition_id = c.id
       JOIN group_members gm ON gm.group_id = g.id
       JOIN users u          ON u.id = gm.user_id
       WHERE m.status = 'scheduled'
         AND date(m.start_time) = date('now', '+1 day')
         AND date(m.start_time) = (
           SELECT MIN(date(m2.start_time))
           FROM matches m2
           WHERE m2.competition_id = m.competition_id
             AND m2.round = m.round
         )`,
    )
    .all<ReminderRow>()

  if (userRows.results.length === 0) {
    console.info('[roundReminder] Nenhuma rodada começa amanhã.')
    return
  }

  // Group by competition + round, collecting e-mail addresses.
  const grouped = new Map<string, RoundGroup>()
  for (const row of userRows.results) {
    const key = `${row.competition_name}::${row.round}`
    const entry = grouped.get(key)
    if (entry) {
      if (!entry.emails.includes(row.email)) entry.emails.push(row.email)
    } else {
      grouped.set(key, {
        competitionName: row.competition_name,
        round: row.round,
        emails: [row.email],
        matches: [],
      })
    }
  }

  // Query 2: all scheduled matches for those rounds (may span more than one day),
  // joined with team names, ordered by kick-off time.
  const matchRows = await db
    .prepare(
      `SELECT
         c.name   AS competition_name,
         m.round  AS round,
         ht.name  AS home_team,
         awt.name AS away_team,
         m.start_time
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       JOIN teams ht       ON ht.id = m.home_team_id
       JOIN teams awt      ON awt.id = m.away_team_id
       WHERE m.status = 'scheduled'
         AND (
           SELECT MIN(date(m2.start_time))
           FROM matches m2
           WHERE m2.competition_id = m.competition_id
             AND m2.round = m.round
         ) = date('now', '+1 day')
       ORDER BY m.start_time ASC`,
    )
    .all<MatchRow>()

  // Attach match info to the corresponding round group.
  for (const row of matchRows.results) {
    const key = `${row.competition_name}::${row.round}`
    const entry = grouped.get(key)
    if (entry) {
      entry.matches.push({
        home: row.home_team,
        away: row.away_team,
        time: formatBRT(row.start_time),
      })
    }
  }

  let sent = 0
  for (const { competitionName, round, emails, matches } of grouped.values()) {
    const html = buildEmailHtml(competitionName, round, matches)
    const subject = `Rodada ${round} começa amanhã — faça seus palpites!`

    // One e-mail per user (no shared BCC, so addresses never leak between users).
    // A single send failure is isolated so the rest of the batch still goes out.
    for (const email of emails) {
      try {
        await sendEmail(resendApiKey, { to: email, subject, html })
        sent++
      } catch (err) {
        console.error(`[roundReminder] Falha ao enviar para ${email}:`, err)
      }
    }
  }

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron sendRoundReminders',
      rounds: grouped.size,
      sent,
      total_ms: Date.now() - startedAt,
    }),
  )
}

// BRT = UTC-3, no DST since 2019.
function formatBRT(isoUtc: string): string {
  return new Date(isoUtc).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildEmailHtml(competitionName: string, round: string, matches: MatchInfo[]): string {
  const matchRows = matches
    .map(
      (m) => `
      <tr>
        <td style="padding: 8px 4px; text-align: right; font-weight: bold;">${m.home}</td>
        <td style="padding: 8px 8px; text-align: center; color: #6b7280;">vs</td>
        <td style="padding: 8px 4px; text-align: left; font-weight: bold;">${m.away}</td>
        <td style="padding: 8px 4px 8px 16px; text-align: left; color: #6b7280; white-space: nowrap;">${m.time}</td>
      </tr>`,
    )
    .join('')

  const matchTable =
    matches.length > 0
      ? `<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">${matchRows}</table>`
      : ''

  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">A Rodada ${round} começa amanhã!</h2>
      <p style="color: #6b7280; margin-top: 0;">${competitionName}</p>
      ${matchTable}
      <p style="margin-top: 16px;">Não esquece de registrar seus palpites antes do primeiro jogo!</p>
      <a href="${APP_URL}" style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 8px;">Fazer meus palpites</a>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        Você está recebendo este e-mail porque participa de um grupo no Palpitae.
      </p>
    </div>
  `
}
