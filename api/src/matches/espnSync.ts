import type { D1Database } from '@cloudflare/workers-types'
import {
  type EspnCompetitor,
  type EspnCompetitorTeam,
  type EspnEventCompetition,
  type EspnScoreboardEvent,
  ESPN_POSTPONED_STATUSES,
  fetchEspnScoreboard,
  isEspnFinal,
} from '../providers/espn'
import type { ProviderHttpObserver } from '../observability/providerHttp'
import {
  batchStatements,
  countTbdDiscards,
  isoSeconds,
  MATCH_UPSERT_SQL,
  type MatchUpsertRow,
  NO_RESULT,
  reportDiscards,
  slugify,
  type SyncDiscard,
  type SyncResult,
  writeMatchUpserts,
} from './sync'

const PROVIDER = 'espn'

export type EspnPrimaryCompetitionMeta = {
  name: string
  slugPrefix: string
  /** Default cup. Ligas de pontos corridos usam league. */
  type?: 'cup' | 'league'
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
  'bra.2': {
    name: 'Brasileirão Série B',
    slugPrefix: 'brasileirao-serie-b',
    type: 'league',
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
 * Lookup literal: só slugs comprovados nos spikes entram aqui. Caminhos
 * paralelos (Taça Guanabara / Taça Rio, Troféu Inconfidência / playoffs,
 * Farroupilha / título, rebaixamento) ficam com códigos distintos para o
 * admin configurar `penalty_phases` por fase. Slugs fora do mapa ainda podem
 * ser fase de liga via `resolveEspnStage` (padrão `YYYY-…`); qualquer outro
 * é descartado (fail-closed) e registrado com o slug em `sync_event_discarded`.
 * Sem regex ampla e sem leitura de notas/texto.
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
  'league-phase': 'LEAGUE_PHASE',
  'regular-season': 'REGULAR_SEASON',
  'knockout-round-playoffs': 'PLAYOFFS',
  'round-of-16': 'LAST_16',
  quarterfinals: 'QUARTER_FINALS',
  semifinals: 'SEMI_FINALS',
  '3rd-place': 'THIRD_PLACE',
  'third-place': 'THIRD_PLACE',
  final: 'FINAL',
  finals: 'FINAL',
  // Campeonato Carioca (bra.camp.carioca): Taça Guanabara, Taça Rio, rebaixamento.
  // A ESPN codifica o hífen tipográfico do rótulo com três hífens no slug.
  'taca-guanabara': 'TACA_GUANABARA',
  'taca-guanabara---quarterfinals': 'TACA_GUANABARA_QUARTER_FINALS',
  'taca-guanabara---semifinals': 'TACA_GUANABARA_SEMI_FINALS',
  'taca-guanabara---final': 'TACA_GUANABARA_FINAL',
  'taca-rio---semifinals': 'TACA_RIO_SEMI_FINALS',
  'taca-rio---final': 'TACA_RIO_FINAL',
  'relegation-stage': 'RELEGATION_STAGE',
  // Campeonato Mineiro (bra.camp.mineiro): Troféu Inconfidência e playoffs do título.
  'trofeu-inconfidencia---semifinals': 'TROFEU_INCONFIDENCIA_SEMI_FINALS',
  'trofeu-inconfidencia---finals': 'TROFEU_INCONFIDENCIA_FINAL',
  'playoffs---semifinals': 'PLAYOFFS_SEMI_FINALS',
  'playoffs---final': 'PLAYOFFS_FINAL',
  // Campeonato Gaúcho (bra.camp.gaucho): rebaixamento e Farroupilha.
  'gaucho---relegation': 'RELEGATION_STAGE',
  'farroupilha---semifinals': 'FARROUPILHA_SEMI_FINALS',
  'farroupilha---finals': 'FARROUPILHA_FINAL',
}

const LEAGUE_PHASE = 'REGULAR_SEASON'

/**
 * Resolve `event.season.slug` da ESPN para a fase canônica.
 *
 * 1. Exceção contextual: em `bra.camp.gaucho`, `first-round` é classificatória
 *    de grupos → GROUP_STAGE (não mata-mata). Em outras copas o mesmo slug
 *    continua FIRST_ROUND eliminatório.
 * 2. Slug no mapa de copa/mata-mata → código mapeado (ex.: semifinals → SEMI_FINALS).
 * 3. Slug no padrão `YYYY-…` (identificador de temporada da liga, ex.:
 *    `2026-brasileiro-serie-b`) → REGULAR_SEASON.
 * 4. Qualquer outro slug → descartado (fail-closed).
 */
function resolveEspnStage(slug: string | undefined, competitionCode?: string): string | undefined {
  if (!slug) return undefined
  // Gaúcho: first-round comprovada como fase de grupos/pontos (spike 2026).
  // Chave = competição + slug; não inferir por presença incompleta de group.
  if (competitionCode === 'bra.camp.gaucho' && slug === 'first-round') {
    return 'GROUP_STAGE'
  }
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

/**
 * Adiado ou cancelado em state 'post' não começou, e o palpite segue aberto
 * (ADR-013). Em state 'in', o adiamento veio depois do início e o jogo trava.
 */
const ESPN_NOT_STARTED_STATUSES = new Set([
  'STATUS_POSTPONED',
  'STATUS_CANCELED',
  'STATUS_CANCELLED',
])

export type EspnSyncOptions = {
  competitionCode: string
  season: number
  dates?: string[]
  db: D1Database
  now?: string
  onHttpAttempt?: ProviderHttpObserver
  ae?: AnalyticsEngineDataset
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
  final: boolean
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

function isPlaceholderCompetitor(comp: EspnCompetitor | undefined): boolean {
  const team = comp?.team
  return [team?.displayName, team?.shortDisplayName, team?.abbreviation].some(isEspnPlaceholder)
}

function toValidCompetitor(comp: EspnCompetitor | undefined): ValidEspnCompetitor | null {
  const team: EspnCompetitorTeam | undefined = comp?.team
  const id = typeof team?.id === 'string' ? team.id.trim() : ''
  const displayName = typeof team?.displayName === 'string' ? team.displayName.trim() : ''
  if (!id || !displayName || isPlaceholderCompetitor(comp)) return null
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

/** Evento que o sync não importa, com o motivo. */
type Discarded = { ok: false; discard: SyncDiscard }

function discarded(reason: SyncDiscard['reason'], detail: string): Discarded {
  return { ok: false, discard: { reason, detail } }
}

/** Mandante e visitante válidos, ou o motivo do descarte. */
function extractCompetitors(
  comp: EspnEventCompetition,
): { ok: true; home: ValidEspnCompetitor; away: ValidEspnCompetitor } | Discarded {
  const competitors = comp.competitors ?? []
  const rawHome = competitors.find((c) => c.homeAway === 'home')
  const rawAway = competitors.find((c) => c.homeAway === 'away')
  const home = toValidCompetitor(rawHome)
  const away = toValidCompetitor(rawAway)
  if (!home || !away) {
    const tbd = isPlaceholderCompetitor(rawHome) || isPlaceholderCompetitor(rawAway)
    return discarded('missing_competitor', tbd ? 'tbd' : '')
  }
  if (home.team.id === away.team.id) return discarded('invalid_event', 'same_team')
  return { ok: true, home, away }
}

function resolveStartTime(rawDate: unknown): string | null {
  if (typeof rawDate !== 'string') return null
  const parsed = Date.parse(rawDate)
  if (!Number.isFinite(parsed)) return null
  return isoSeconds(new Date(parsed))
}

/** Evento importável, ou o motivo pelo qual o sync o descarta. */
function extractValidEvent(
  ev: EspnScoreboardEvent,
  season: number,
  competitionCode?: string,
): { ok: true; event: ValidEspnEvent } | Discarded {
  const id = typeof ev.id === 'string' ? ev.id.trim() : ''
  if (!id) return discarded('invalid_event', 'id')
  // O scoreboard pode responder com outra edição ao consultar datas futuras.
  // Só o ano explícito do evento autoriza importá-lo para a temporada pedida.
  if (ev.season?.year !== season) {
    return discarded('season_mismatch', String(ev.season?.year ?? ''))
  }

  const stage = resolveEspnStage(ev.season?.slug, competitionCode)
  if (!stage) return discarded('unknown_stage', ev.season?.slug ?? '')
  const startTime = resolveStartTime(ev.date)
  if (!startTime) return discarded('invalid_event', 'date')
  const comp: EspnEventCompetition | undefined = ev.competitions?.[0]
  if (!comp) return discarded('invalid_event', 'competition')

  const competitors = extractCompetitors(comp)
  if (!competitors.ok) return competitors
  const { home, away } = competitors

  const statusType = comp.status?.type ?? ev.status?.type
  const rawLeg = comp.leg?.value
  const leg: 1 | 2 | null = rawLeg === 1 || rawLeg === 2 ? rawLeg : null
  return {
    ok: true,
    event: {
      id,
      startTime,
      stage,
      round: resolveEspnRound(ev, stage),
      leg,
      groupName: parseGroupName(comp.group?.name),
      state: statusType?.state,
      statusName: statusType?.name ?? '',
      final: isEspnFinal(statusType),
      home,
      away,
    },
  }
}

async function fetchEventsForSync(
  competitionCode: string,
  dates?: string[],
  onAttempt?: ProviderHttpObserver,
): Promise<EspnScoreboardEvent[]> {
  const uniqueDates = dates ? Array.from(new Set(dates.filter(Boolean))) : []
  if (uniqueDates.length === 0) {
    const board = await fetchEspnScoreboard(competitionCode, undefined, onAttempt)
    return board.events ?? []
  }

  // Sequencial: o cliente ESPN já serializa HTTP com pacing; evitar enfileirar
  // N promises de uma vez deixa o custo e o progresso observáveis por data.
  const byId = new Map<string, EspnScoreboardEvent>()
  for (const yyyymmdd of uniqueDates) {
    const board = await fetchEspnScoreboard(competitionCode, yyyymmdd, onAttempt)
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

  const competitionType = meta.type ?? 'cup'

  await db
    .prepare(
      `INSERT INTO competitions (id, name, slug, external_id, provider, season, status, type, visibility)
       VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?, 'pilot')
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
      competitionType,
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
       logo_url   = excluded.logo_url
     -- Sem mudança, sem gravação (o sync reenvia todos os times a cada tick).
     WHERE teams.name       IS NOT excluded.name
        OR teams.short_name IS NOT excluded.short_name
        OR teams.logo_url   IS NOT excluded.logo_url`,
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
): Pick<MatchUpsertRow, 'duration' | 'penaltyWinner' | 'homePenaltyGoals' | 'awayPenaltyGoals'> {
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
  if (ev.state === 'post' && ESPN_NOT_STARTED_STATUSES.has(ev.statusName)) return null
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
  const isFinished = ev.final && homeParsed !== null && awayParsed !== null

  const result = isFinished
    ? {
        status: 'finished' as const,
        homeScore: homeParsed,
        awayScore: awayParsed,
        ...resolveFinishedOutcome(ev),
      }
    : NO_RESULT

  return {
    externalId: ev.id,
    homeTeamId,
    awayTeamId,
    startTime: ev.startTime,
    ...result,
    phase: ev.stage,
    round: ev.round,
    groupName: ev.groupName,
    leg: ev.leg,
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
  ae: AnalyticsEngineDataset | undefined,
): Promise<number> {
  const matchInsertStmt = db.prepare(MATCH_UPSERT_SQL)
  const rows: MatchUpsertRow[] = []
  const statements = []

  for (const ev of events) {
    const row = mapEspnEventToRow(ev, teamIds, now)
    if (!row) continue

    rows.push(row)
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

  await writeMatchUpserts(db, statements, rows, { ae, provider: PROVIDER, competitionId })

  return statements.length
}

export async function syncEspnFixtures(opts: EspnSyncOptions): Promise<SyncResult> {
  const meta = ESPN_PRIMARY_COMPETITIONS[opts.competitionCode]
  if (!meta) {
    throw new Error(`Competição ESPN desconhecida ${opts.competitionCode}`)
  }

  const rawEvents = await fetchEventsForSync(opts.competitionCode, opts.dates, opts.onHttpAttempt)
  const validEvents: ValidEspnEvent[] = []
  const discards: SyncDiscard[] = []
  for (const raw of rawEvents) {
    const extracted = extractValidEvent(raw, opts.season, opts.competitionCode)
    if (extracted.ok) validEvents.push(extracted.event)
    else discards.push(extracted.discard)
  }
  const discardScope = {
    ae: opts.ae,
    provider: PROVIDER,
    competitionCode: opts.competitionCode,
    season: opts.season,
  }

  if (validEvents.length === 0) {
    return {
      competition: meta.name,
      competitionId: '',
      matches: 0,
      teams: 0,
      discarded: await reportDiscards(opts.db, discards, discardScope),
      discardedTbd: countTbdDiscards(discards),
      missing: 0,
    }
  }

  const competition = await upsertEspnCompetition(opts.db, opts.competitionCode, meta, opts.season)
  const { teamCount, teamIds } = await upsertEspnTeams(opts.db, validEvents)
  const now = opts.now ?? isoSeconds(new Date())
  const matchCount = await upsertEspnMatches(
    opts.db,
    competition.id,
    validEvents,
    teamIds,
    now,
    opts.ae,
  )
  const discarded = await reportDiscards(opts.db, discards, {
    ...discardScope,
    competitionId: competition.id,
  })

  return {
    competition: meta.name,
    competitionId: competition.id,
    matches: matchCount,
    teams: teamCount,
    discarded,
    discardedTbd: countTbdDiscards(discards),
    missing: 0,
  }
}
