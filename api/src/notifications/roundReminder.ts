import type { AnalyticsEngineDataset, D1Database } from '@cloudflare/workers-types'
import { hashUserId, logEvent } from '../observability/events'
import { type EmailMessage, EmailError, sendEmail } from './email'
import { signUnsubToken } from './unsubscribeToken'

const APP_URL = 'https://palpitae.com.br'

// Resend's default account limit is ~2 req/s. Sequential awaited sends already
// pace us, but a burst still risks 429s, and transient 5xx happen. Retry those
// (the once-a-day cron never gets a second chance otherwise); fail fast on other
// 4xx, which are permanent (bad address, etc.).
const MAX_SEND_ATTEMPTS = 3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sends one e-mail, retrying on 429 (rate limit) and 5xx / network errors with
 * exponential backoff that honours Resend's Retry-After. Permanent 4xx fail fast.
 * Throws if every attempt fails so the caller counts it and moves on.
 */
async function sendWithRetry(apiKey: string, msg: EmailMessage): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await sendEmail(apiKey, msg)
      return
    } catch (err) {
      const status = err instanceof EmailError ? err.status : 0
      const transient = status === 429 || status >= 500 || status === 0
      if (!transient || attempt >= MAX_SEND_ATTEMPTS) throw err
      const retryAfterMs = err instanceof EmailError ? err.retryAfterMs : undefined
      // Reactive backoff: on 429 this self-throttles the batch under the limit.
      await sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1))
    }
  }
}

type ReminderRow = {
  competition_id: string
  competition_name: string
  round: string
  user_id: string
  email: string
  group_id: string
  group_name: string
}

/** A user to notify. groups are all their groups for this competition+round. */
type Recipient = {
  id: string
  email: string
  groups: { id: string; name: string }[]
}

/** Config for unsubscribe links/headers. Omitted in tests → no link rendered. */
type UnsubConfig = {
  secret: string
  apiBaseUrl: string
}

type MatchRow = {
  competition_id: string
  competition_name: string
  round: string
  home_team: string
  away_team: string
  home_logo: string | null
  away_logo: string | null
  start_time: string
}

type MatchInfo = {
  home: string
  away: string
  homeLogo: string | null
  awayLogo: string | null
  time: string
}

type RoundGroup = {
  competitionId: string
  competitionName: string
  round: string
  recipients: Recipient[]
  matches: MatchInfo[]
}

/**
 * Sends an e-mail reminder to every group member whose competition has a round
 * starting tomorrow AND who has not predicted any of that round's matches yet.
 * Designed to run once a day from a daily Cron Trigger.
 *
 * Only fires on the round's FIRST match day: the WHERE clause requires tomorrow
 * to equal the earliest scheduled match date of that (competition, round). This
 * prevents re-notifying mid-round when a round spans several days. Combined with
 * the once-a-day cron, no per-send dedupe table is needed.
 *
 * start_time is stored as ISO 8601 with T/Z (e.g. "2026-06-16T22:00:00Z"), which
 * SQLite's date() parses correctly. Date math shifts by '-3 hours' to align day
 * boundaries with BRT (UTC-3, no DST since 2019) — without this, a match at
 * 21:00–23:59 BRT lands on the following UTC day, causing the e-mail to say
 * "começa amanhã" when the match is actually today for Brazilian users.
 */
export async function sendRoundReminders(
  db: D1Database,
  resendApiKey: string,
  ae?: AnalyticsEngineDataset,
  appUrl: string = APP_URL,
  unsub?: UnsubConfig,
): Promise<void> {
  const startedAt = Date.now()

  // Fail loud, not silent: with no key every send would 401 and be counted as a
  // dropped reminder. Skip the run and surface the misconfiguration instead.
  if (!resendApiKey) {
    console.error('[roundReminder] RESEND_API_KEY ausente — nenhum lembrete enviado.')
    logEvent(ae, 'cron_round_reminder', { doubles: [0, 0, 0] })
    return
  }

  // ISO 8601 with T/Z, same format the matches list endpoint uses (matches/router.ts)
  // so the default_round subquery below resolves to EXACTLY the same round the app
  // shows by default. start_time is stored in this format, so the `> ?` comparison
  // is a correct lexicographic compare.
  const nowIso = new Date().toISOString()

  // Query 1: which users need to be notified?
  //  - the round's first match is tomorrow (don't re-notify mid-round);
  //  - the round is the competition's default_round — the earliest round still
  //    open (MAX(start_time) in the future). This MUST match matches/router.ts so
  //    the e-mail never goes out before the app has advanced to that round (e.g.
  //    while the previous round still has an unfinished match);
  //  - the user has no prediction yet for any match of that round in that group
  //    (NOT EXISTS).
  const userRows = await db
    .prepare(
      `SELECT DISTINCT
         c.id    AS competition_id,
         c.name  AS competition_name,
         m.round AS round,
         u.id    AS user_id,
         u.email AS email,
         g.id    AS group_id,
         g.name  AS group_name
       FROM matches m
       JOIN competitions c   ON c.id = m.competition_id
       JOIN groups g         ON g.competition_id = c.id
       JOIN group_members gm ON gm.group_id = g.id
       JOIN users u          ON u.id = gm.user_id
       WHERE m.status = 'scheduled'
         AND u.email_unsubscribed_at IS NULL
         AND date(m.start_time, '-3 hours') = date('now', '-3 hours', '+1 day')
         AND date(m.start_time, '-3 hours') = (
           SELECT MIN(date(m2.start_time, '-3 hours'))
           FROM matches m2
           WHERE m2.competition_id = m.competition_id
             AND m2.round = m.round
         )
         AND m.round = (
           SELECT m3.round
           FROM matches m3
           WHERE m3.competition_id = m.competition_id
           GROUP BY m3.round
           HAVING MAX(m3.start_time) > ?1
           ORDER BY MAX(m3.start_time) ASC
           LIMIT 1
         )
         AND NOT EXISTS (
           SELECT 1
           FROM predictions p
           JOIN matches pm ON pm.id = p.match_id
           WHERE p.user_id  = u.id
             AND p.group_id = g.id
             AND pm.competition_id = c.id
             AND pm.round = m.round
         )`,
    )
    .bind(nowIso)
    .all<ReminderRow>()

  if (userRows.results.length === 0) {
    console.info('[roundReminder] Nenhuma rodada começa amanhã.')
    logEvent(ae, 'cron_round_reminder', { doubles: [0, 0, 0] })
    return
  }

  // Group by competition + round, collecting e-mail addresses. Dedupe is still
  // required even with the NOT EXISTS filter: a user may have predicted in group
  // A but not group B of the same competition, appearing twice in the result.
  const grouped = new Map<string, RoundGroup>()
  for (const row of userRows.results) {
    const key = `${row.competition_id}::${row.round}`
    const entry = grouped.get(key)
    if (entry) {
      const existing = entry.recipients.find((r) => r.email === row.email)
      if (existing) {
        // Same user, additional group for this competition+round → add group link.
        if (!existing.groups.some((g) => g.id === row.group_id)) {
          existing.groups.push({ id: row.group_id, name: row.group_name })
        }
      } else {
        entry.recipients.push({ id: row.user_id, email: row.email, groups: [{ id: row.group_id, name: row.group_name }] })
      }
    } else {
      grouped.set(key, {
        competitionId: row.competition_id,
        competitionName: row.competition_name,
        round: row.round,
        recipients: [{ id: row.user_id, email: row.email, groups: [{ id: row.group_id, name: row.group_name }] }],
        matches: [],
      })
    }
  }

  // Query 2: all scheduled matches for those rounds (may span more than one day),
  // joined with team names, ordered by kick-off time.
  const matchRows = await db
    .prepare(
      `SELECT
         c.id         AS competition_id,
         c.name       AS competition_name,
         m.round      AS round,
         ht.name      AS home_team,
         awt.name     AS away_team,
         ht.logo_url  AS home_logo,
         awt.logo_url AS away_logo,
         m.start_time
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       JOIN teams ht       ON ht.id = m.home_team_id
       JOIN teams awt      ON awt.id = m.away_team_id
       WHERE m.status = 'scheduled'
         AND (
           SELECT MIN(date(m2.start_time, '-3 hours'))
           FROM matches m2
           WHERE m2.competition_id = m.competition_id
             AND m2.round = m.round
         ) = date('now', '-3 hours', '+1 day')
         AND m.round = (
           SELECT m3.round
           FROM matches m3
           WHERE m3.competition_id = m.competition_id
           GROUP BY m3.round
           HAVING MAX(m3.start_time) > ?1
           ORDER BY MAX(m3.start_time) ASC
           LIMIT 1
         )
       ORDER BY m.start_time ASC`,
    )
    .bind(nowIso)
    .all<MatchRow>()

  // Attach match info to the corresponding round group.
  for (const row of matchRows.results) {
    const key = `${row.competition_id}::${row.round}`
    const entry = grouped.get(key)
    if (entry) {
      entry.matches.push({
        home: row.home_team,
        away: row.away_team,
        homeLogo: row.home_logo,
        awayLogo: row.away_logo,
        time: formatBRT(row.start_time),
      })
    }
  }

  // Guard an empty/undefined apiBaseUrl: `.replace` on undefined would throw and
  // abort the whole batch inside waitUntil. Without a base URL we simply render
  // no unsubscribe link (the `unsub && apiBaseUrl` check below).
  const apiBaseUrl = unsub?.apiBaseUrl ? unsub.apiBaseUrl.replace(/\/+$/, '') : undefined

  let sent = 0
  let failed = 0
  for (const { competitionName, round, recipients, matches } of grouped.values()) {
    const subject = `Rodada ${round} começa amanhã — faça seus palpites!`

    // One e-mail per user (no shared BCC, so addresses never leak between users).
    // A single send failure is isolated so the rest of the batch still goes out.
    // The unsubscribe link is per-user (signed token), so the body is built per
    // recipient — match list rebuild is cheap at this volume.
    for (const { id, email, groups: recipientGroups } of recipients) {
      try {
        const unsubUrl =
          unsub && apiBaseUrl
            ? `${apiBaseUrl}/notifications/unsubscribe?token=${await signUnsubToken(id, unsub.secret)}`
            : undefined

        const html = buildEmailHtml(competitionName, round, matches, appUrl, recipientGroups, unsubUrl)
        const text = buildEmailText(competitionName, round, matches, appUrl, recipientGroups, unsubUrl)
        // RFC 8058 one-click unsubscribe — Gmail/Apple show a native button.
        const headers = unsubUrl
          ? {
              'List-Unsubscribe': `<${unsubUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : undefined

        await sendWithRetry(resendApiKey, { to: email, subject, html, text, headers })
        sent++
        // user_hash do id (não o e-mail cru — PII, regra LGPD).
        logEvent(ae, 'email_reminder_sent', {
          blobs: [await hashUserId(id), competitionName, round],
        })
      } catch (err) {
        failed++
        console.error(`[roundReminder] Falha ao enviar para ${await hashUserId(id)}:`, err)
      }
    }
  }

  logEvent(ae, 'cron_round_reminder', { doubles: [grouped.size, sent, failed] })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron sendRoundReminders',
      rounds: grouped.size,
      sent,
      failed,
      total_ms: Date.now() - startedAt,
    }),
  )
}

// BRT = UTC-3, no DST since 2019.
export function formatBRT(isoUtc: string): string {
  return new Date(isoUtc).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Escapes the five HTML-significant characters. Round names and team names come
 * from the database and may legitimately contain `"`, `'` or `&` (e.g. "Quartas
 * de Final", apostrophes). Escaping keeps the markup well-formed and avoids any
 * injection into the rendered e-mail.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Appends UTM params to the CTA link so GA4 (which auto-captures utm_*) attributes
 * site visits originating from this e-mail. See docs/analytics.md.
 */
function withEmailUtm(url: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}utm_source=email&utm_medium=email&utm_campaign=round_reminder`
}

/**
 * Renders a team crest as an inline <img>. Returns '' when there's no logo.
 *
 * NOTE: many crests from football-data.org are SVG, and Gmail/Outlook do not
 * render SVG images in e-mail — those degrade to the `alt` text. PNG crests show
 * fine. The image is kept small and the team name is always shown next to it, so
 * a missing crest never breaks the layout.
 */
function crestImg(url: string | null, alt: string): string {
  if (!url || !/^https?:\/\//i.test(url)) return ''
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="20" height="20" style="vertical-align: middle; border: 0;">`
}

function buildEmailHtml(
  competitionName: string,
  round: string,
  matches: MatchInfo[],
  appUrl: string,
  groups: { id: string; name: string }[],
  unsubUrl?: string,
): string {
  const matchRows = matches
    .map(
      (m) => `
      <tr>
        <td style="padding: 8px 4px; text-align: right; font-weight: bold;">${escapeHtml(m.home)}&nbsp;${crestImg(m.homeLogo, m.home)}</td>
        <td style="padding: 8px 8px; text-align: center; color: #6b7280;">vs</td>
        <td style="padding: 8px 4px; text-align: left; font-weight: bold;">${crestImg(m.awayLogo, m.away)}&nbsp;${escapeHtml(m.away)}</td>
        <td style="padding: 8px 4px 8px 16px; text-align: left; color: #6b7280; white-space: nowrap;">${escapeHtml(m.time)}</td>
      </tr>`,
    )
    .join('')

  const matchTable =
    matches.length > 0
      ? `<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">${matchRows}</table>`
      : ''

  const ctaButtons =
    groups.length === 1
      ? `<a href="${escapeHtml(withEmailUtm(`${appUrl}/grupos/${groups[0].id}`))}" style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 8px;">Fazer meus palpites</a>`
      : groups
          .map(
            (g) =>
              `<a href="${escapeHtml(withEmailUtm(`${appUrl}/grupos/${g.id}`))}" style="display: inline-block; background: #16a34a; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 4px 4px 0 0;">${escapeHtml(g.name)}</a>`,
          )
          .join('')

  const safeRound = escapeHtml(round)
  const safeCompetition = escapeHtml(competitionName)
  const logoUrl = escapeHtml(`${appUrl}/apple-touch-icon.png`)

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rodada ${safeRound} começa amanhã</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6;">
  <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
    <div style="text-align: center; padding: 16px 0 24px;">
      <img src="${logoUrl}" alt="" width="48" height="48" style="border-radius: 10px; border: 0; display: block; margin: 0 auto 8px;">
      <span style="font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">Palpitae</span>
    </div>
    <h2 style="margin-bottom: 4px;">A Rodada ${safeRound} começa amanhã!</h2>
    <p style="color: #6b7280; margin-top: 0;">${safeCompetition}</p>
    ${matchTable}
    <p style="margin-top: 16px;">Não esquece de registrar seus palpites antes do primeiro jogo!</p>
    ${groups.length > 1 ? '<p style="margin-bottom: 4px; font-weight: bold;">Fazer meus palpites:</p>' : ''}
    ${ctaButtons}
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      Você está recebendo este e-mail porque participa de um grupo no Palpitae.${
        unsubUrl
          ? `<br>Não quer mais estes lembretes? <a href="${escapeHtml(unsubUrl)}" style="color: #6b7280;">Cancelar inscrição</a>.`
          : ''
      }
    </p>
  </div>
</body>
</html>`
}

/**
 * Plain-text fallback for clients that prefer text/plain over HTML. Resend sends
 * whichever the recipient's client picks; without this, text-only clients show
 * raw HTML.
 */
function buildEmailText(
  competitionName: string,
  round: string,
  matches: MatchInfo[],
  appUrl: string,
  groups: { id: string; name: string }[],
  unsubUrl?: string,
): string {
  const lines = [
    `A Rodada ${round} começa amanhã!`,
    competitionName,
    '',
  ]
  for (const m of matches) {
    lines.push(`${m.home} vs ${m.away} — ${m.time}`)
  }
  if (matches.length > 0) lines.push('')
  lines.push('Não esquece de registrar seus palpites antes do primeiro jogo!')
  if (groups.length === 1) {
    lines.push(`Fazer meus palpites: ${withEmailUtm(`${appUrl}/grupos/${groups[0].id}`)}`)
  } else {
    lines.push('Fazer meus palpites:')
    for (const g of groups) {
      lines.push(`  ${g.name}: ${withEmailUtm(`${appUrl}/grupos/${g.id}`)}`)
    }
  }
  lines.push('')
  lines.push('Você está recebendo este e-mail porque participa de um grupo no Palpitae.')
  if (unsubUrl) lines.push(`Cancelar inscrição: ${unsubUrl}`)
  return lines.join('\n')
}
