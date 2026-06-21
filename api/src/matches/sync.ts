import type { D1Database } from '@cloudflare/workers-types'

const PROVIDER = 'football-data'
const API_BASE = 'https://api.football-data.org/v4'

const TEAM_TRANSLATIONS: Record<string, { name: string; short_name: string }> = {
  Germany: { name: 'Alemanha', short_name: 'ALE' },
  'Saudi Arabia': { name: 'Arábia Saudita', short_name: 'ARA' },
  Argentina: { name: 'Argentina', short_name: 'ARG' },
  Australia: { name: 'Austrália', short_name: 'AUS' },
  Belgium: { name: 'Bélgica', short_name: 'BEL' },
  Brazil: { name: 'Brasil', short_name: 'BRA' },
  Cameroon: { name: 'Camarões', short_name: 'CAM' },
  Canada: { name: 'Canadá', short_name: 'CAN' },
  Qatar: { name: 'Catar', short_name: 'CAT' },
  'South Korea': { name: 'Coreia do Sul', short_name: 'COR' },
  'Costa Rica': { name: 'Costa Rica', short_name: 'CRC' },
  Croatia: { name: 'Croácia', short_name: 'CRO' },
  Denmark: { name: 'Dinamarca', short_name: 'DIN' },
  Ecuador: { name: 'Equador', short_name: 'EQU' },
  Spain: { name: 'Espanha', short_name: 'ESP' },
  USA: { name: 'Estados Unidos', short_name: 'EUA' },
  'United States': { name: 'Estados Unidos', short_name: 'EUA' },
  France: { name: 'França', short_name: 'FRA' },
  Wales: { name: 'Gales', short_name: 'GAL' },
  Ghana: { name: 'Gana', short_name: 'GAN' },
  Netherlands: { name: 'Holanda', short_name: 'HOL' },
  England: { name: 'Inglaterra', short_name: 'ING' },
  Iran: { name: 'Irã', short_name: 'IRA' },
  Italy: { name: 'Itália', short_name: 'ITA' },
  Japan: { name: 'Japão', short_name: 'JAP' },
  Morocco: { name: 'Marrocos', short_name: 'MAR' },
  Mexico: { name: 'México', short_name: 'MEX' },
  Poland: { name: 'Polônia', short_name: 'POL' },
  Portugal: { name: 'Portugal', short_name: 'POR' },
  Senegal: { name: 'Senegal', short_name: 'SEN' },
  Serbia: { name: 'Sérvia', short_name: 'SER' },
  Switzerland: { name: 'Suíça', short_name: 'SUI' },
  Tunisia: { name: 'Tunísia', short_name: 'TUN' },
  Uruguay: { name: 'Uruguai', short_name: 'URU' },
  Algeria: { name: 'Argélia', short_name: 'ARG' },
  Austria: { name: 'Áustria', short_name: 'AUT' },
  Bolivia: { name: 'Bolívia', short_name: 'BOL' },
  Chile: { name: 'Chile', short_name: 'CHI' },
  Colombia: { name: 'Colômbia', short_name: 'COL' },
  'Ivory Coast': { name: 'Costa do Marfim', short_name: 'CIV' },
  Egypt: { name: 'Egito', short_name: 'EGI' },
  Greece: { name: 'Grécia', short_name: 'GRE' },
  Nigeria: { name: 'Nigéria', short_name: 'NIG' },
  Norway: { name: 'Noruega', short_name: 'NOR' },
  Paraguay: { name: 'Paraguai', short_name: 'PAR' },
  Peru: { name: 'Peru', short_name: 'PER' },
  'Czech Republic': { name: 'República Tcheca', short_name: 'TCH' },
  Sweden: { name: 'Suécia', short_name: 'SUE' },
  Turkey: { name: 'Turquia', short_name: 'TUR' },
  Ukraine: { name: 'Ucrânia', short_name: 'UCR' },
  Venezuela: { name: 'Venezuela', short_name: 'VEN' },
}

const COMP_TRANSLATIONS: Record<string, string> = {
  'World Cup': 'Copa do Mundo',
  'European Championship': 'Eurocopa',
  'Copa América': 'Copa América',
}

type ApiTeam = {
  id: number
  name: string
  shortName: string
  tla: string
  crest: string
}

type ApiMatch = {
  id: number
  utcDate: string
  status: string
  matchday: number | null
  stage: string
  group: string | null
  homeTeam: ApiTeam
  awayTeam: ApiTeam
  score: {
    fullTime: { home: number | null; away: number | null }
  }
}

type ApiCompetition = {
  id: number
  name: string
  code: string
}

type ApiMatchesResponse = {
  competition: ApiCompetition
  matches: ApiMatch[]
}

export type SyncOptions = {
  /** Competition code, e.g. "WC" for FIFA World Cup */
  competitionCode: string
  season: number
  /** Optional matchday filter, e.g. 1 for round 1 */
  matchday?: number
  apiKey: string
  db: D1Database
}

export type SyncResult = {
  competition: string
  competitionId: string
  matches: number
  teams: number
}

/**
 * Maps football-data.org status to internal status.
 * Ref: https://www.football-data.org/documentation/quickstart
 */
function mapStatus(status: string): 'scheduled' | 'live' | 'finished' {
  if (status === 'FINISHED' || status === 'AWARDED') return 'finished'
  if (status === 'IN_PLAY' || status === 'LIVE' || status === 'PAUSED') return 'live'
  return 'scheduled'
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Syncs fixtures from football-data.org into D1.
 * Upserts: competition, teams, and matches.
 *
 * Copa do Mundo 2026: competitionCode="WC", season=2026
 * First matchday only: matchday=1
 */
export async function syncFixtures(opts: SyncOptions): Promise<SyncResult> {
  const { competitionCode, season, matchday, apiKey, db } = opts

  const url = new URL(`${API_BASE}/competitions/${competitionCode}/matches`)
  url.searchParams.set('season', String(season))
  if (matchday !== undefined) url.searchParams.set('matchday', String(matchday))

  const res = await fetch(url.toString(), {
    headers: { 'X-Auth-Token': apiKey },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`football-data.org respondeu ${res.status}: ${text}`)
  }

  const data = (await res.json()) as ApiMatchesResponse

  const { competition: apiComp, matches } = data

  const competitionName = apiComp ? (COMP_TRANSLATIONS[apiComp.name] ?? apiComp.name) : competitionCode

  if (matches.length === 0) {
    return { competition: competitionName, competitionId: '', matches: 0, teams: 0 }
  }

  const competitionExternalId = String(apiComp.id)
  const competitionSlug = slugify(`${competitionName}-${season}`)

  // Upsert competition
  await db
    .prepare(
      `INSERT INTO competitions (id, name, slug, external_id, provider, season, status)
       VALUES (?, ?, ?, ?, ?, ?, 'upcoming')
       ON CONFLICT (slug) DO UPDATE SET
         external_id = excluded.external_id,
         provider    = excluded.provider,
         season      = excluded.season`,
    )
    .bind(
      crypto.randomUUID(),
      competitionName,
      competitionSlug,
      competitionExternalId,
      PROVIDER,
      String(season),
    )
    .run()

  const competition = await db
    .prepare(`SELECT id FROM competitions WHERE slug = ?`)
    .bind(competitionSlug)
    .first<{ id: string }>()

  if (!competition) throw new Error('Competição não encontrada após upsert')

  // Collect unique teams
  const teamMap = new Map<number, ApiTeam>()
  for (const m of matches) {
    if (m.homeTeam?.id) teamMap.set(m.homeTeam.id, m.homeTeam)
    if (m.awayTeam?.id) teamMap.set(m.awayTeam.id, m.awayTeam)
  }

  // Upsert teams
  for (const team of teamMap.values()) {
    const translated = TEAM_TRANSLATIONS[team.name]
    const finalName = translated?.name ?? team.name
    const finalShortName =
      translated?.short_name ?? (team.tla ?? team.shortName ?? team.name.substring(0, 3).toUpperCase())

    await db
      .prepare(
        `INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (external_id, provider) DO UPDATE SET
           logo_url   = excluded.logo_url`,
      )
      .bind(
        crypto.randomUUID(),
        finalName,
        finalShortName,
        slugify(team.name),
        team.crest ?? null,
        String(team.id),
        PROVIDER,
      )
      .run()
  }

  // Resolve internal team IDs
  const teamIds = new Map<number, string>()
  for (const extId of teamMap.keys()) {
    const row = await db
      .prepare(`SELECT id FROM teams WHERE external_id = ? AND provider = ?`)
      .bind(String(extId), PROVIDER)
      .first<{ id: string }>()
    if (row) teamIds.set(extId, row.id)
  }

  // Upsert matches
  let matchCount = 0
  for (const m of matches) {
    const homeTeamId = teamIds.get(m.homeTeam?.id)
    const awayTeamId = teamIds.get(m.awayTeam?.id)
    if (!homeTeamId || !awayTeamId) continue

    const status = mapStatus(m.status)
    const phase = m.stage ?? null
    const round = m.matchday !== null ? String(m.matchday) : (m.group ?? '1')
    const groupName = m.group ? m.group.replace(/^GROUP_/, '') : null

    await db
      .prepare(
        `INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (external_id, provider) DO UPDATE SET
           status     = excluded.status,
           home_score = excluded.home_score,
           away_score = excluded.away_score,
           start_time = excluded.start_time,
           group_name = excluded.group_name,
           -- If a provider score-correction lands after the match was already
           -- scored, clear scored_at so scoreUnprocessedMatches re-runs and the
           -- points/leaderboard recompute against the final score. Without this,
           -- the displayed score updates but points stay frozen on the stale one
           -- (e.g. exact 4-0 predictors stuck at 1pt after a 3-0→4-0 correction).
           scored_at  = CASE
             WHEN matches.home_score IS NOT excluded.home_score
               OR matches.away_score IS NOT excluded.away_score
             THEN NULL ELSE matches.scored_at END`,
      )
      .bind(
        crypto.randomUUID(),
        competition.id,
        String(m.id),
        PROVIDER,
        homeTeamId,
        awayTeamId,
        m.utcDate,
        status,
        m.score.fullTime.home ?? null,
        m.score.fullTime.away ?? null,
        phase,
        round,
        groupName,
      )
      .run()

    matchCount++
  }

  return {
    competition: competitionName,
    competitionId: competition.id,
    matches: matchCount,
    teams: teamMap.size,
  }
}
