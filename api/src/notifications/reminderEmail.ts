import { roundLabel } from '../matches/rounds'

export const REMINDER_TIME_ZONE = 'America/Sao_Paulo'
export const MAX_DIGEST_GROUPS = 10

export type DigestMatch = {
  home: string
  away: string
  homeLogo: string | null
  awayLogo: string | null
  startTime: string
}

export type DigestRound = {
  competitionId: string
  round: string | null
  matches: DigestMatch[]
}

export type DigestGroup = {
  groupId: string
  groupName: string
  competitionName: string
  rounds: DigestRound[]
}

/** E-mail de um usuário com os jogos sem palpite do dia, por grupo e rodada. */
export type Digest = {
  userId: string
  email: string
  groups: DigestGroup[]
  matchIds: Set<string>
  firstStart: string
  lastSent: string | null
}

// Um formatter por módulo. O cron formata por jogo e por destinatário.
const TIME_BRT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: REMINDER_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
})

/** Horário do jogo em Brasília, "19:30". O palpite fecha nesse horário (ADR-004). */
export function formatTimeBRT(isoUtc: string): string {
  return TIME_BRT_FORMAT.format(new Date(isoUtc))
}

export function reminderSubject(matchCount: number, firstStart: string): string {
  const time = formatTimeBRT(firstStart)
  return matchCount === 1
    ? `1 jogo sem palpite hoje. Fecha às ${time}`
    : `${matchCount} jogos sem palpite hoje. O primeiro fecha às ${time}`
}

function predictionsUrl(appUrl: string, groupId: string, round: string | null): string {
  const query = round ? `?rodada=${encodeURIComponent(round)}` : ''
  return `${appUrl}/grupos/${groupId}${query}`
}

/**
 * Escapa os cinco caracteres com significado em HTML. Nomes de grupo, rodada e time
 * vêm do banco e podem ter `"`, `'` ou `&`. O nome do grupo é escrito pelo usuário.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function crestImg(url: string | null, alt: string): string {
  if (!url || !/^https?:\/\//i.test(url)) return ''
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="20" height="20" style="vertical-align: middle; border: 0;">`
}

interface EmailTemplateOptions {
  digest: Digest
  subject: string
  appUrl: string
  unsubUrl?: string
}

/**
 * Cada jogo ocupa duas linhas. A primeira tem "escudo mandante x visitante escudo" em
 * colunas de largura fixa. A segunda tem o horário, centralizado igual em todos os blocos.
 * O escudo e o nome ficam num `span` sem quebra, então nunca se separam.
 */
function matchRowHtml(match: DigestMatch): string {
  const nowrap = 'white-space: nowrap;'
  return `
      <tr>
        <td style="width: 45%; padding: 8px 4px 0; text-align: right; font-weight: bold;"><span style="${nowrap}">${escapeHtml(match.home)}&nbsp;${crestImg(match.homeLogo, match.home)}</span></td>
        <td style="width: 10%; padding: 8px 4px 0; text-align: center; color: #6b7280;">x</td>
        <td style="width: 45%; padding: 8px 4px 0; text-align: left; font-weight: bold;"><span style="${nowrap}">${crestImg(match.awayLogo, match.away)}&nbsp;${escapeHtml(match.away)}</span></td>
      </tr>
      <tr>
        <td colspan="3" style="padding: 2px 4px 8px; text-align: center; color: #6b7280; font-size: 13px;">fecha ${escapeHtml(formatTimeBRT(match.startTime))}</td>
      </tr>`
}

function groupBlockHtml(group: DigestGroup, appUrl: string): string {
  const rounds = group.rounds
    .map((round) => {
      const url = predictionsUrl(appUrl, group.groupId, round.round)
      return `
    <p style="margin: 8px 0 0; color: #6b7280;">${escapeHtml(roundLabel(round.round ?? ''))}</p>
    <table style="width: 100%; table-layout: fixed; border-collapse: collapse; margin: 8px 0;">${round.matches.map(matchRowHtml).join('')}</table>
    <p style="margin: 4px 0 0;"><a href="${escapeHtml(url)}" style="color: #16a34a; font-weight: bold;">Fazer meus palpites &rarr;</a></p>`
    })
    .join('')

  return `
    <h3 style="margin: 24px 0 0; font-size: 16px;">${escapeHtml(group.groupName)}</h3>
    <p style="margin: 2px 0 0; color: #6b7280;">${escapeHtml(group.competitionName)}</p>${rounds}`
}

export function buildEmailHtml({ digest, subject, appUrl, unsubUrl }: EmailTemplateOptions): string {
  const groups = digest.groups
    .slice(0, MAX_DIGEST_GROUPS)
    .map((group) => groupBlockHtml(group, appUrl))
    .join('')
  const remaining = digest.groups.length - MAX_DIGEST_GROUPS
  const more =
    remaining > 0
      ? `\n    <p><a href="${escapeHtml(appUrl)}">e mais ${remaining} ${remaining === 1 ? 'grupo' : 'grupos'}</a></p>`
      : ''

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6;">
  <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
    <div style="padding: 8px 0 16px;">
      <span style="font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">Palpitae</span>
    </div>
    <h2 style="margin: 0 0 4px;">${escapeHtml(subject)}</h2>
    <p style="color: #6b7280; margin-top: 0;">Cada palpite fecha no horário do jogo.</p>${groups}${more}
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

/** Versão em texto puro, para clientes que preferem text/plain. */
export function buildEmailText({ digest, subject, appUrl, unsubUrl }: EmailTemplateOptions): string {
  const lines = [subject, 'Cada palpite fecha no horário do jogo.']
  for (const group of digest.groups.slice(0, MAX_DIGEST_GROUPS)) {
    lines.push('', group.groupName, group.competitionName)
    for (const round of group.rounds) {
      lines.push(roundLabel(round.round ?? ''))
      for (const match of round.matches) {
        lines.push(`${match.home} vs ${match.away}, fecha ${formatTimeBRT(match.startTime)}`)
      }
      lines.push(`Fazer meus palpites: ${predictionsUrl(appUrl, group.groupId, round.round)}`)
    }
  }
  const remaining = digest.groups.length - MAX_DIGEST_GROUPS
  if (remaining > 0)
    lines.push('', `e mais ${remaining} ${remaining === 1 ? 'grupo' : 'grupos'} ${appUrl}`)
  lines.push('', 'Você está recebendo este e-mail porque participa de um grupo no Palpitae.')
  if (unsubUrl) lines.push(`Cancelar inscrição: ${unsubUrl}`)
  return lines.join('\n')
}
