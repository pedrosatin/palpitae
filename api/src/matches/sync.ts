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
  'World Cup': 'Copa do Mundo FIFA',
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
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
    duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT' | null
    fullTime: { home: number | null; away: number | null }
    halfTime: { home: number | null; away: number | null }
    regularTime?: { home: number | null; away: number | null } // presente em ET e PENALTY_SHOOTOUT
    extraTime?: { home: number | null; away: number | null } // idem
    penalties?: { home: number | null; away: number | null } // só em PENALTY_SHOOTOUT
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
  /** Instante do sync (ISO 8601). Padrão: agora. Usado para gravar `locked_at`. */
  now?: string
}

export type SyncResult = {
  competition: string
  competitionId: string
  matches: number
  teams: number
}

export function resolveCanonicalScore(score: ApiMatch['score']): {
  canonicalHome: number | null
  canonicalAway: number | null
} {
  const isShootout = score.duration === 'PENALTY_SHOOTOUT'
  let canonicalHome = score.fullTime.home ?? null
  let canonicalAway = score.fullTime.away ?? null

  if (isShootout) {
    const rtHome = score.regularTime?.home
    const rtAway = score.regularTime?.away
    if (rtHome !== null && rtHome !== undefined && rtAway !== null && rtAway !== undefined) {
      // Fonte canônica: regularTime + extraTime (nunca contaminados por pênaltis).
      canonicalHome = rtHome + (score.extraTime?.home ?? 0)
      canonicalAway = rtAway + (score.extraTime?.away ?? 0)
    } else if (
      canonicalHome !== null &&
      canonicalAway !== null &&
      canonicalHome !== canonicalAway
    ) {
      // Fallback: fullTime diferente → provider embutiu pênaltis → subtrai.
      canonicalHome -= score.penalties?.home ?? 0
      canonicalAway -= score.penalties?.away ?? 0

      // Sanity check: shootout implies a draw. If subtraction yields a non-draw or negative score,
      // fallback to the most reasonable non-negative draw score.
      if (canonicalHome < 0 || canonicalAway < 0 || canonicalHome !== canonicalAway) {
        const drawScore = Math.max(0, Math.min(canonicalHome, canonicalAway))
        canonicalHome = drawScore
        canonicalAway = drawScore
      }
    }
    // else: fullTime já é o placar do empate.
  }

  return { canonicalHome, canonicalAway }
}

/**
 * Maps football-data.org status to internal status.
 * Ref: https://www.football-data.org/documentation/quickstart
 */
function mapStatus(status: string): 'scheduled' | 'finished' {
  if (status === 'FINISHED' || status === 'AWARDED') return 'finished'
  return 'scheduled'
}

/**
 * Status em que o provider diz que o jogo não vai acontecer no horário marcado.
 * Todos continuam mapeando para `status = 'scheduled'` (o CHECK do schema não
 * comporta outro valor, ver migration 0013) — a flag `postponed` é que carrega
 * a informação para o locking e para a UI.
 */
const POSTPONED_STATUSES = new Set(['POSTPONED', 'SUSPENDED', 'CANCELLED'])

function isPostponed(status: string): boolean {
  return POSTPONED_STATUSES.has(status)
}

/**
 * Status em que o jogo já começou (ou terminou). SUSPENDED entra aqui: o jogo foi
 * interrompido depois do início e o placar parcial já é conhecido, então o palpite
 * tem que continuar travado mesmo com `postponed = 1`.
 */
const STARTED_STATUSES = new Set(['IN_PLAY', 'PAUSED', 'LIVE', 'SUSPENDED', 'FINISHED', 'AWARDED'])

/**
 * `locked_at` proposto para a linha: o instante do sync quando o provider indica
 * que o jogo começou. Horário vencido sozinho não conta: um adiamento visto depois
 * do horário original, sem o jogo ter começado, ainda reabre o palpite. O upsert
 * nunca apaga um `locked_at` existente (ver MATCH_UPSERT_SQL).
 */
export function resolveLockedAt(providerStatus: string, now: string): string | null {
  return STARTED_STATUSES.has(providerStatus) ? now : null
}

/** ISO 8601 sem milissegundos, no mesmo formato de `start_time`. */
function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
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

async function fetchMatchesFromApi(
  competitionCode: string,
  season: number,
  matchday: number | undefined,
  apiKey: string,
): Promise<ApiMatchesResponse> {
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

  return (await res.json()) as ApiMatchesResponse
}

function resolveCompetitionName(
  apiComp: ApiCompetition | undefined,
  competitionCode: string,
): string {
  // Fuzzy lookup: a API manda "FIFA World Cup", o mapa tem a chave "World Cup".
  // includes() casa sem precisar duplicar variações da chave no mapa.
  const translationKey = apiComp
    ? Object.keys(COMP_TRANSLATIONS).find((key) => apiComp.name.includes(key))
    : undefined
  return apiComp
    ? translationKey
      ? COMP_TRANSLATIONS[translationKey]
      : apiComp.name
    : competitionCode
}

async function upsertCompetition(
  db: D1Database,
  apiComp: ApiCompetition,
  competitionName: string,
  season: number,
): Promise<{ id: string }> {
  const competitionExternalId = String(apiComp.id)
  // Slug deriva do nome CRU da API (não do traduzido) p/ ficar estável: mudar a
  // tradução de exibição não pode mudar a chave de conflito do upsert, senão um
  // re-sync criaria uma competição duplicada (slug = 'fifa-world-cup-2026' em prod).
  const competitionSlug = slugify(`${apiComp.name}-${season}`)

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
  return competition
}

async function batchStatements(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 100) {
    await db.batch(statements.slice(i, i + 100))
  }
}

async function upsertTeams(
  db: D1Database,
  matches: ApiMatch[],
): Promise<{ teamMap: Map<number, ApiTeam>; teamIds: Map<number, string> }> {
  const teamMap = new Map<number, ApiTeam>()
  for (const m of matches) {
    if (m.homeTeam?.id) teamMap.set(m.homeTeam.id, m.homeTeam)
    if (m.awayTeam?.id) teamMap.set(m.awayTeam.id, m.awayTeam)
  }

  const teamStatements = []
  const teamInsertStmt = db.prepare(
    `INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id, provider) DO UPDATE SET
       logo_url   = excluded.logo_url`,
  )

  for (const team of teamMap.values()) {
    const translated = TEAM_TRANSLATIONS[team.name]
    const finalName = translated?.name ?? team.name
    const finalShortName =
      translated?.short_name ??
      team.tla ??
      team.shortName ??
      team.name.substring(0, 3).toUpperCase()

    teamStatements.push(
      teamInsertStmt.bind(
        crypto.randomUUID(),
        finalName,
        finalShortName,
        slugify(team.name),
        team.crest ?? null,
        String(team.id),
        PROVIDER,
      ),
    )
  }

  if (teamStatements.length > 0) {
    await batchStatements(db, teamStatements)
  }

  const teamIds = new Map<number, string>()
  const extIds = Array.from(teamMap.keys())

  if (extIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT external_id, id FROM teams WHERE external_id IN (SELECT value FROM json_each(?)) AND provider = ?`,
      )
      .bind(JSON.stringify(extIds.map(String)), PROVIDER)
      .all<{ external_id: string; id: string }>()

    for (const row of results) {
      teamIds.set(Number(row.external_id), row.id)
    }
  }

  return { teamMap, teamIds }
}

type MatchUpsertRow = {
  externalId: string
  homeTeamId: string
  awayTeamId: string
  startTime: string
  status: 'scheduled' | 'finished'
  homeScore: number | null
  awayScore: number | null
  phase: string | null
  round: string
  groupName: string | null
  duration: ApiMatch['score']['duration']
  penaltyWinner: 'home' | 'away' | null
  homePenaltyGoals: number | null
  awayPenaltyGoals: number | null
  postponed: 0 | 1
  lockedAt: string | null
}

/**
 * Vencedor dos pênaltis só faz sentido em PENALTY_SHOOTOUT (score.winner também
 * vem preenchido em jogos REGULAR, onde significa o vencedor no tempo normal).
 * Se o provider mandar winner como null (comum em empates com disputa de pênaltis
 * concluída), derivamos pelo placar da DISPUTA (score.penalties) — fonte canônica
 * e que nunca empata. NÃO derivar de fullTime: quando o provider manda winner null
 * ele também devolve fullTime = placar do tempo normal (empate), o que faria a
 * derivação retornar null e zerar o bônus de pênalti de quem acertou.
 */
function resolvePenaltyWinner(score: ApiMatch['score']): 'home' | 'away' | null {
  if (score.duration !== 'PENALTY_SHOOTOUT') return null
  if (score.winner === 'HOME_TEAM') return 'home'
  if (score.winner === 'AWAY_TEAM') return 'away'

  const homePenalties = score.penalties?.home ?? 0
  const awayPenalties = score.penalties?.away ?? 0
  if (homePenalties > awayPenalties) return 'home'
  if (homePenalties < awayPenalties) return 'away'
  return null
}

function mapGroupName(group: string | null): string | null {
  return group ? group.replace(/^GROUP_/, '') : null
}

function mapRound(matchday: number | null, stage: string): string {
  return matchday !== null ? String(matchday) : stage
}

/**
 * Placar canônico = o que o palpite compara (tempo regulamentar + prorrogação,
 * SEM pênaltis). Em PENALTY_SHOOTOUT o fullTime da football-data às vezes INCLUI os
 * gols de pênalti, e outras vezes não (além de regularTime e extraTime ocasionalmente
 * virem nulos).
 *
 * Estratégia (prioridade decrescente):
 * 1. Se regularTime está disponível (não-null): canonicalScore = regularTime + extraTime.
 *    Esses campos NUNCA incluem gols de pênalti e são a fonte mais confiável.
 * 2. Se regularTime é null (provider omitiu) e fullTime é diferente: subtrai os gols
 *    de pênalti de fullTime. Essa heurística assume que o provider embutiu os pênaltis
 *    em fullTime — o que só acontece quando os valores são desiguais.
 * 3. fullTime igual: já é o placar do empate, não faz nada.
 */
function mapMatchUpsertRow(
  m: ApiMatch,
  teamIds: Map<number, string>,
  now: string,
): MatchUpsertRow | null {
  const homeTeamId = teamIds.get(m.homeTeam?.id)
  const awayTeamId = teamIds.get(m.awayTeam?.id)
  if (!homeTeamId || !awayTeamId) return null

  const isShootout = m.score.duration === 'PENALTY_SHOOTOUT'
  const { canonicalHome, canonicalAway } = resolveCanonicalScore(m.score)

  return {
    externalId: String(m.id),
    homeTeamId,
    awayTeamId,
    startTime: m.utcDate,
    status: mapStatus(m.status),
    homeScore: canonicalHome,
    awayScore: canonicalAway,
    phase: m.stage ?? null,
    round: mapRound(m.matchday, m.stage),
    groupName: mapGroupName(m.group),
    duration: m.score.duration ?? null,
    penaltyWinner: resolvePenaltyWinner(m.score),
    homePenaltyGoals: isShootout ? (m.score.penalties?.home ?? null) : null,
    awayPenaltyGoals: isShootout ? (m.score.penalties?.away ?? null) : null,
    postponed: isPostponed(m.status) ? 1 : 0,
    lockedAt: resolveLockedAt(m.status, now),
  }
}

const MATCH_UPSERT_SQL = `INSERT INTO matches (
       id, competition_id, external_id, provider, home_team_id, away_team_id,
       start_time, status, home_score, away_score, phase, round, group_name,
       duration, penalty_winner, home_penalty_goals, away_penalty_goals, postponed,
       locked_at
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )
     ON CONFLICT (external_id, provider) DO UPDATE SET
       -- Travamento permanente: uma vez preenchido, locked_at não volta a NULL. É
       -- preenchido na primeira vez que o sync vê o jogo iniciado: status local
       -- anterior 'live'/'finished' ou status de início vindo do provider. No
       -- DO UPDATE, matches.* são os valores antigos da linha.
       locked_at          = COALESCE(
                              matches.locked_at,
                              CASE WHEN matches.status IN ('live', 'finished') THEN ? END,
                              excluded.locked_at
                            ),
       status             = excluded.status,
       postponed          = excluded.postponed,
       home_score         = excluded.home_score,
       away_score         = excluded.away_score,
       -- Enquanto o jogo está adiado o provider zera o horário para um placeholder
       -- de meia-noite (ex: "2026-07-29T00:00:00Z" nos 4 jogos adiados da rodada 21
       -- do Brasileirão). Gravar isso puxaria o kickoff para ANTES do original e
       -- bagunçaria ordenação e default_round. Preserva-se o horário conhecido até
       -- o provider tirar o POSTPONED com uma data real — aí o UPDATE volta a valer.
       -- Sem heurística de "parece placeholder": 00:00Z é kickoff legítimo no
       -- Brasileirão (21h BRT), então detectar pelo horário daria falso positivo.
       start_time         = CASE WHEN excluded.postponed = 1
                                 THEN matches.start_time ELSE excluded.start_time END,
       group_name         = excluded.group_name,
       duration           = excluded.duration,
       penalty_winner     = excluded.penalty_winner,
       home_penalty_goals = excluded.home_penalty_goals,
       away_penalty_goals = excluded.away_penalty_goals,
       -- If a provider score-correction lands after the match was already
       -- scored, clear scored_at so scoreUnprocessedMatches re-runs and the
       -- points/leaderboard recompute against the final score. Without this,
       -- the displayed score updates but points stay frozen on the stale one
       -- (e.g. exact 4-0 predictors stuck at 1pt after a 3-0→4-0 correction).
       -- penalty_winner também dispara o re-score: o provider pode corrigir só
       -- o vencedor dos pênaltis sem mexer no placar canônico.
       scored_at  = CASE
         WHEN matches.home_score IS NOT excluded.home_score
           OR matches.away_score IS NOT excluded.away_score
           OR matches.penalty_winner IS NOT excluded.penalty_winner
         THEN NULL ELSE matches.scored_at END`

async function upsertMatches(
  db: D1Database,
  competitionId: string,
  matches: ApiMatch[],
  teamIds: Map<number, string>,
  now: string,
): Promise<number> {
  const matchInsertStmt = db.prepare(MATCH_UPSERT_SQL)
  const matchStatements = []

  for (const m of matches) {
    const row = mapMatchUpsertRow(m, teamIds, now)
    if (!row) continue

    matchStatements.push(
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
        now,
      ),
    )
  }

  if (matchStatements.length > 0) {
    await batchStatements(db, matchStatements)
  }

  return matchStatements.length
}

export async function syncFixtures(opts: SyncOptions): Promise<SyncResult> {
  const { competitionCode, season, matchday, apiKey, db } = opts

  const data = await fetchMatchesFromApi(competitionCode, season, matchday, apiKey)
  const { competition: apiComp, matches } = data

  const competitionName = resolveCompetitionName(apiComp, competitionCode)

  if (matches.length === 0) {
    return {
      competition: competitionName,
      competitionId: '',
      matches: 0,
      teams: 0,
    }
  }

  const competition = await upsertCompetition(db, apiComp, competitionName, season)
  const { teamMap, teamIds } = await upsertTeams(db, matches)
  const now = opts.now ?? isoSeconds(new Date())
  const matchCount = await upsertMatches(db, competition.id, matches, teamIds, now)

  return {
    competition: competitionName,
    competitionId: competition.id,
    matches: matchCount,
    teams: teamMap.size,
  }
}
