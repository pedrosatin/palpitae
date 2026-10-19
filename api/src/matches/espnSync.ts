import type { D1Database } from '@cloudflare/workers-types'
import {
  type EspnCompetitor,
  type EspnCompetitorTeam,
  type EspnEventCompetition,
  type EspnScoreboardEvent,
  fetchEspnScoreboard,
} from '../providers/espn'
import {
  batchStatements,
  isoSeconds,
  MATCH_UPSERT_SQL,
  type MatchUpsertRow,
  slugify,
  type SyncResult,
} from './sync'

const PROVIDER = 'espn'

export type EspnPrimaryCompetitionMeta = {
  name: string
  slugPrefix: string
}

/**
 * Competições cujo provider primário é a ESPN, fora do free tier da
 * football-data.org. A chave é o slug da competição na API da ESPN e também o
 * valor gravado em `competitions.external_id`.
 */
export const ESPN_PRIMARY_COMPETITIONS: Record<string, EspnPrimaryCompetitionMeta> = {
  'conmebol.libertadores': {
    name: 'Copa Libertadores',
    slugPrefix: 'conmebol-libertadores',
  },
  'conmebol.sudamericana': {
    name: 'Copa Sul-Americana',
    slugPrefix: 'conmebol-sudamericana',
  },
  'bra.copa_do_brazil': {
    name: 'Copa do Brasil',
    slugPrefix: 'copa-do-brasil',
  },
}

export function isEspnPrimaryCompetition(code: string): boolean {
  return Object.hasOwn(ESPN_PRIMARY_COMPETITIONS, code)
}

/**
 * Tradução de `event.season.slug` da ESPN para o código canônico de fase das
 * copas (mata-mata e grupos). Usado pelos rótulos PT-BR em `rounds.ts` e pelo
 * gate de pênaltis em `competitions.penalty_phases`.
 *
 * Slugs fora deste mapa ainda podem ser fase de liga: ver `resolveEspnStage`.
 */
const ESPN_STAGE_MAP: Record<string, string> = {
  'first-stage': 'FIRST_STAGE',
  'second-stage': 'SECOND_STAGE',
  'third-stage': 'THIRD_STAGE',
  'first-round': 'FIRST_ROUND',
  'second-round': 'SECOND_ROUND',
  'third-round': 'THIRD_ROUND',
  'fourth-round': 'FOURTH_ROUND',
  'fifth-round': 'FIFTH_ROUND',
  'group-stage': 'GROUP_STAGE',
  'knockout-round-playoffs': 'PLAYOFFS',
  'round-of-16': 'LAST_16',
  quarterfinals: 'QUARTER_FINALS',
  semifinals: 'SEMI_FINALS',
  '3rd-place': 'THIRD_PLACE',
  'third-place': 'THIRD_PLACE',
  final: 'FINAL',
}

const LEAGUE_PHASE = 'REGULAR_SEASON'

/**
 * Resolve `event.season.slug` da ESPN para a fase canônica.
 *
 * 1. Slug no mapa de copa/mata-mata → código mapeado (ex.: semifinals → SEMI_FINALS).
 * 2. Slug no padrão `YYYY-…` (identificador de temporada da liga, ex.:
 *    `2026-brasileiro-serie-b`) → REGULAR_SEASON.
 * 3. Qualquer outro slug → descartado (fail-closed).
 */
function resolveEspnStage(slug: string | undefined): string | undefined {
  if (!slug) return undefined
  const mapped = ESPN_STAGE_MAP[slug]
  if (mapped) return mapped
  // Temporada de liga: a ESPN usa o id da edição (`2026-brasileiro-serie-b`)
  // no lugar da fase de mata-mata. Aceita o padrão YYYY-… como REGULAR_SEASON.
  if (/^\d{4}-/.test(slug)) return LEAGUE_PHASE
  return undefined
}

/**
 * Rodada numérica quando a ESPN expõe week/matchday; senão a própria fase
 * (mesmo padrão das copas, onde round = stage).
 */
function resolveEspnRound(ev: EspnScoreboardEvent, stage: string): string {
  if (stage !== LEAGUE_PHASE) return stage

  const week = ev.week
  if (typeof week === 'number' && Number.isFinite(week) && week >= 0) {
    return String(Math.trunc(week))
  }
  if (week && typeof week === 'object') {
    const n = week.number
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      return String(Math.trunc(n))
    }
  }
  const matchday = ev.matchday
  if (typeof matchday === 'number' && Number.isFinite(matchday) && matchday >= 0) {
    return String(Math.trunc(matchday))
  }
  return LEAGUE_PHASE
}

const ESPN_POSTPONED_STATUSES = new Set([
  'STATUS_POSTPONED',
  'STATUS_CANCELED',
  'STATUS_CANCELLED',
  'STATUS_SUSPENDED',
  'STATUS_ABANDONED',
])

export type EspnSyncOptions = {
  competitionCode: string
  season: number
  dates?: string[]
  db: D1Database
  now?: string
}

type ValidEspnTeam = {
  id: string
  displayName: string
  shortDisplayName?: string
  abbreviation?: string
  logo?: string
}

type ValidEspnCompetitor = {
  winner?: boolean
  score?: string
  shootoutScore?: number
  team: ValidEspnTeam
}

type ValidEspnEvent = {
  id: string
  startTime: string
  stage: string
  round: string
  leg: 1 | 2 | null
  groupName: string | null
  state: string | undefined
  statusName: string
  home: ValidEspnCompetitor
  away: ValidEspnCompetitor
}

function parseGroupName(rawName: string | undefined): string | null {
  const trimmed = rawName?.trim()
  if (!trimmed) return null
  const stripped = trimmed.replace(/^(?:Group|Grupo)\s+/i, '').trim()
  return stripped || null
}

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  return Number(raw)
}

function isEspnPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && /^TBD(?:\s+(?:Home|Away))?$/i.test(value.trim())
}

function toValidCompetitor(comp: EspnCompetitor | undefined): ValidEspnCompetitor | null {
  const team: EspnCompetitorTeam | undefined = comp?.team
  const id = typeof team?.id === 'string' ? team.id.trim() : ''
  const displayName = typeof team?.displayName === 'string' ? team.displayName.trim() : ''
  if (!id || !displayName) return null
  if ([displayName, team?.shortDisplayName, team?.abbreviation].some(isEspnPlaceholder)) {
    return null
  }
  return {
    winner: comp?.winner,
    score: comp?.score,
    shootoutScore: comp?.shootoutScore,
    team: {
      id,
      displayName,
      shortDisplayName: team?.shortDisplayName,
      abbreviation: team?.abbreviation,
      logo: team?.logo,
    },
  }
}

function resolveStartTime(rawDate: unknown): string | null {
  if (typeof rawDate !== 'string') return null
  const parsed = Date.parse(rawDate)
  if (!Number.isFinite(parsed)) return null
  return isoSeconds(new Date(parsed))
}

function extractValidEvent(ev: EspnScoreboardEvent, season: number): ValidEspnEvent | null {
  const id = typeof ev.id === 'string' ? ev.id.trim() : ''
  if (!id) return null
  // O scoreboard pode responder com outra edição ao consultar datas futuras.
  // Só o ano explícito do evento autoriza importá-lo para a temporada pedida.
  if (ev.season?.year !== season) return null

  const stage = resolveEspnStage(ev.season?.slug)
  const startTime = resolveStartTime(ev.date)
  const comp: EspnEventCompetition | undefined = ev.competitions?.[0]
  if (!stage || !startTime || !comp) return null

  const competitors = comp.competitors ?? []
  const home = toValidCompetitor(competitors.find((c) => c.homeAway === 'home'))
  const away = toValidCompetitor(competitors.find((c) => c.homeAway === 'away'))
  if (!home || !away || home.team.id === away.team.id) return null

  const statusType = comp.status?.type ?? ev.status?.type
  const rawLeg = comp.leg?.value
  const leg: 1 | 2 | null = rawLeg === 1 || rawLeg === 2 ? rawLeg : null
  return {
    id,
    startTime,
    stage,
    round: resolveEspnRound(ev, stage),
    leg,
    groupName: parseGroupName(comp.group?.name),
    state: statusType?.state,
    statusName: statusType?.name ?? '',
    home,
    away,
  }
}

async function fetchEventsForSync(
  competitionCode: string,
  dates?: string[],
): Promise<EspnScoreboardEvent[]> {
  const uniqueDates = dates ? Array.from(new Set(dates.filter(Boolean))) : []
  if (uniqueDates.length === 0) {
    const board = await fetchEspnScoreboard(competitionCode)
    return board.events ?? []
  }

  const boards = await Promise.all(
    uniqueDates.map((yyyymmdd) => fetchEspnScoreboard(competitionCode, yyyymmdd)),
  )
  const byId = new Map<string, EspnScoreboardEvent>()
  for (const board of boards) {
    for (const ev of board.events ?? []) {
      if (typeof ev.id === 'string' && ev.id) {
        byId.set(ev.id, ev)
      }
    }
  }
  return Array.from(byId.values())
}

async function upsertEspnCompetition(
  db: D1Database,
  competitionCode: string,
  meta: EspnPrimaryCompetitionMeta,
  season: number,
): Promise<{ id: string }> {
  const competitionSlug = `${meta.slugPrefix}-${season}`

  await db
    .prepare(
      `INSERT INTO competitions (id, name, slug, external_id, provider, season, status, type, visibility)
       VALUES (?, ?, ?, ?, ?, ?, 'upcoming', 'cup', 'pilot')
       ON CONFLICT (slug) DO UPDATE SET
         external_id = excluded.external_id,
         provider    = excluded.provider,
         season      = excluded.season`,
    )
    .bind(
      crypto.randomUUID(),
      meta.name,
      competitionSlug,
      competitionCode,
      PROVIDER,
      String(season),
    )
    .run()

  const competition = await db
    .prepare(`SELECT id FROM competitions WHERE slug = ?`)
    .bind(competitionSlug)
    .first<{ id: string }>()

  if (!competition) throw new Error('Competição não encontrada após upsert')
  return competition
}

function resolveTeamShortName(team: ValidEspnTeam): string {
  const abbr = team.abbreviation?.trim()
  if (abbr) return abbr
  const short = team.shortDisplayName?.trim()
  if (short) return short
  return team.displayName.slice(0, 3).toUpperCase()
}

async function upsertEspnTeams(
  db: D1Database,
  events: ValidEspnEvent[],
): Promise<{ teamCount: number; teamIds: Map<string, string> }> {
  const teamMap = new Map<string, ValidEspnTeam>()
  for (const ev of events) {
    teamMap.set(ev.home.team.id, ev.home.team)
    teamMap.set(ev.away.team.id, ev.away.team)
  }

  const teamInsertStmt = db.prepare(
    `INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id, provider) DO UPDATE SET
       name       = excluded.name,
       short_name = excluded.short_name,
       logo_url   = excluded.logo_url`,
  )

  const statements = Array.from(teamMap.values()).map((team) =>
    teamInsertStmt.bind(
      crypto.randomUUID(),
      team.displayName,
      resolveTeamShortName(team),
      slugify(team.displayName),
      team.logo ?? null,
      team.id,
      PROVIDER,
    ),
  )

  if (statements.length > 0) {
    await batchStatements(db, statements)
  }

  const teamIds = new Map<string, string>()
  const extIds = Array.from(teamMap.keys())
  if (extIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT external_id, id FROM teams WHERE external_id IN (SELECT value FROM json_each(?)) AND provider = ?`,
      )
      .bind(JSON.stringify(extIds), PROVIDER)
      .all<{ external_id: string; id: string }>()

    for (const row of results) {
      teamIds.set(String(row.external_id), row.id)
    }
  }

  return { teamCount: teamMap.size, teamIds }
}

function resolveShootoutWinner(
  home: ValidEspnCompetitor,
  away: ValidEspnCompetitor,
  homePen: number | null,
  awayPen: number | null,
): 'home' | 'away' | null {
  if (homePen !== null && awayPen !== null && homePen !== awayPen) {
    return homePen > awayPen ? 'home' : 'away'
  }
  if (home.winner === true) return 'home'
  if (away.winner === true) return 'away'
  return null
}

function resolveFinishedOutcome(
  ev: ValidEspnEvent,
): Pick<
  MatchUpsertRow,
  'duration' | 'penaltyWinner' | 'homePenaltyGoals' | 'awayPenaltyGoals'
> {
  const hasShootoutScores =
    typeof ev.home.shootoutScore === 'number' && typeof ev.away.shootoutScore === 'number'
  const isShootout = ev.statusName === 'STATUS_FINAL_PEN' || hasShootoutScores

  if (isShootout) {
    const homePen = typeof ev.home.shootoutScore === 'number' ? ev.home.shootoutScore : null
    const awayPen = typeof ev.away.shootoutScore === 'number' ? ev.away.shootoutScore : null
    return {
      duration: 'PENALTY_SHOOTOUT',
      penaltyWinner: resolveShootoutWinner(ev.home, ev.away, homePen, awayPen),
      homePenaltyGoals: homePen,
      awayPenaltyGoals: awayPen,
    }
  }

  return {
    duration: ev.statusName === 'STATUS_FINAL_AET' ? 'EXTRA_TIME' : 'REGULAR',
    penaltyWinner: null,
    homePenaltyGoals: null,
    awayPenaltyGoals: null,
  }
}

function resolveEspnLockedAt(ev: ValidEspnEvent, now: string): string | null {
  if (ev.state === 'in' || ev.state === 'post' || ev.statusName === 'STATUS_SUSPENDED') {
    return now
  }
  return null
}

function mapEspnEventToRow(
  ev: ValidEspnEvent,
  teamIds: Map<string, string>,
  now: string,
): MatchUpsertRow | null {
  const homeTeamId = teamIds.get(ev.home.team.id)
  const awayTeamId = teamIds.get(ev.away.team.id)
  if (!homeTeamId || !awayTeamId) return null

  const homeParsed = parseNonNegativeInt(ev.home.score)
  const awayParsed = parseNonNegativeInt(ev.away.score)
  const isFinished = ev.state === 'post' && homeParsed !== null && awayParsed !== null

  const outcome = isFinished
    ? resolveFinishedOutcome(ev)
    : {
        duration: null,
        penaltyWinner: null,
        homePenaltyGoals: null,
        awayPenaltyGoals: null,
      }

  return {
    externalId: ev.id,
    homeTeamId,
    awayTeamId,
    startTime: ev.startTime,
    status: isFinished ? 'finished' : 'scheduled',
    homeScore: isFinished ? homeParsed : null,
    awayScore: isFinished ? awayParsed : null,
    phase: ev.stage,
    round: ev.round,
    groupName: ev.groupName,
    leg: ev.leg,
    ...outcome,
    postponed: ESPN_POSTPONED_STATUSES.has(ev.statusName) ? 1 : 0,
    lockedAt: resolveEspnLockedAt(ev, now),
  }
}

async function upsertEspnMatches(
  db: D1Database,
  competitionId: string,
  events: ValidEspnEvent[],
  teamIds: Map<string, string>,
  now: string,
): Promise<number> {
  const matchInsertStmt = db.prepare(MATCH_UPSERT_SQL)
  const statements = []

  for (const ev of events) {
    const row = mapEspnEventToRow(ev, teamIds, now)
    if (!row) continue

    statements.push(
      matchInsertStmt.bind(
        crypto.randomUUID(),
        competitionId,
        row.externalId,
        PROVIDER,
        row.homeTeamId,
        row.awayTeamId,
        row.startTime,
        row.status,
        row.homeScore,
        row.awayScore,
        row.phase,
        row.round,
        row.groupName,
        row.duration,
        row.penaltyWinner,
        row.homePenaltyGoals,
        row.awayPenaltyGoals,
        row.postponed,
        row.lockedAt,
        row.leg,
        now,
      ),
    )
  }

  if (statements.length > 0) {
    await batchStatements(db, statements)
  }

  return statements.length
}

export async function syncEspnFixtures(opts: EspnSyncOptions): Promise<SyncResult> {
  const meta = ESPN_PRIMARY_COMPETITIONS[opts.competitionCode]
  if (!meta) {
    throw new Error(`Competição ESPN desconhecida ${opts.competitionCode}`)
  }

  const rawEvents = await fetchEventsForSync(opts.competitionCode, opts.dates)
  const validEvents = rawEvents
    .map((ev) => extractValidEvent(ev, opts.season))
    .filter((ev): ev is ValidEspnEvent => ev !== null)

  if (validEvents.length === 0) {
    return {
      competition: meta.name,
      competitionId: '',
      matches: 0,
      teams: 0,
    }
  }

  const competition = await upsertEspnCompetition(opts.db, opts.competitionCode, meta, opts.season)
  const { teamCount, teamIds } = await upsertEspnTeams(opts.db, validEvents)
  const now = opts.now ?? isoSeconds(new Date())
  const matchCount = await upsertEspnMatches(opts.db, competition.id, validEvents, teamIds, now)

  return {
    competition: meta.name,
    competitionId: competition.id,
    matches: matchCount,
    teams: teamCount,
  }
}

