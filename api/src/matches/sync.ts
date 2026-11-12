import type { D1Database } from '@cloudflare/workers-types'
import { tryLogEvent } from '../observability/events'
import { notifyHttpAttempt, type ProviderHttpObserver } from '../observability/providerHttp'
import { FOOTBALL_DATA_CLUBS } from './clubNames'
import { isEspnPrimaryCompetition, syncEspnFixtures } from './espnSync'
import { footballDataCompetitionConfig } from './footballDataCompetitions'
import { FD_RETRY_BACKOFF_MS, FD_TIMEOUT_MS } from './footballDataQuota'
import { indexTies } from './ties'

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
  /** Competition code, e.g. "WC" for FIFA World Cup or "conmebol.libertadores" for ESPN */
  competitionCode: string
  season: number
  /** Optional matchday filter, e.g. 1 for round 1 */
  matchday?: number
  /** Optional compact dates filter YYYYMMDD (ESPN primary only) */
  dates?: string[]
  apiKey?: string
  db: D1Database
  /** Instante do sync (ISO 8601). Padrão: agora. Usado para gravar `locked_at`. */
  now?: string
  /** Telemetria por tentativa HTTP ao provedor (contexto e competição já embutidos). */
  onHttpAttempt?: ProviderHttpObserver
  /** Recebe `match_teams_changed` quando o provedor troca os times de um jogo gravado. */
  ae?: AnalyticsEngineDataset
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
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function slugify(str: string): string {
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
  onAttempt?: ProviderHttpObserver,
): Promise<ApiMatchesResponse> {
  const url = new URL(`${API_BASE}/competitions/${competitionCode}/matches`)
  url.searchParams.set('season', String(season))
  if (matchday !== undefined) url.searchParams.set('matchday', String(matchday))

  const request = async () => {
    const startedAt = Date.now()
    try {
      const res = await fetch(url.toString(), {
        headers: { 'X-Auth-Token': apiKey },
        signal: AbortSignal.timeout(FD_TIMEOUT_MS),
      })
      notifyHttpAttempt(onAttempt, {
        provider: 'football-data',
        status: res.status,
        durationMs: Date.now() - startedAt,
      })
      return res
    } catch (err) {
      notifyHttpAttempt(onAttempt, {
        provider: 'football-data',
        status: 0,
        durationMs: Date.now() - startedAt,
      })
      throw err
    }
  }

  let res = await request()
  // Um único retry com backoff de 6s. Evita martelar o free tier de 10 req/min em 429.
  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, FD_RETRY_BACKOFF_MS))
    res = await request()
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`football-data.org respondeu ${res.status}: ${text}`)
  }

  return (await res.json()) as ApiMatchesResponse
}

/**
 * Acha a competição pela chave do provedor (id externo + temporada), nunca pelo
 * nome que a API envia: renomear a competição na football-data não pode criar
 * outra. Se ela ainda não existe, cria em piloto com a configuração de
 * `FOOTBALL_DATA_COMPETITIONS`. Código sem configuração não cria nada.
 */
async function upsertCompetition(
  db: D1Database,
  apiComp: ApiCompetition,
  season: number,
  ae: AnalyticsEngineDataset | undefined,
): Promise<{ id: string; name: string }> {
  const externalId = String(apiComp.id)
  const findByKey = () =>
    db
      .prepare(
        `SELECT id, name FROM competitions
          WHERE provider = ? AND external_id = ? AND season = ?`,
      )
      .bind(PROVIDER, externalId, String(season))
      .first<{ id: string; name: string }>()

  const existing = await findByKey()
  if (existing) return existing

  const config = footballDataCompetitionConfig(apiComp.code)
  if (!config) {
    tryLogEvent(ae, 'competition_unconfigured', {
      blobs: [PROVIDER, apiComp.code, externalId, String(season)],
    })
    throw new Error(
      `Competição ${apiComp.code} (${externalId}) sem configuração em FOOTBALL_DATA_COMPETITIONS`,
    )
  }

  // Sem alvo no ON CONFLICT: outra sync que criou a mesma competição antes desta
  // não é erro. Um slug já usado por outra competição também não grava nada, e
  // aí a busca abaixo não acha a linha.
  await db
    .prepare(
      `INSERT INTO competitions
         (id, name, slug, external_id, provider, season, status, type, penalty_phases, visibility)
       VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?, ?, 'pilot')
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      config.name,
      `${config.slugPrefix}-${season}`,
      externalId,
      PROVIDER,
      String(season),
      config.type,
      JSON.stringify(config.penaltyPhases),
    )
    .run()

  const created = await findByKey()
  if (!created) {
    throw new Error(`Slug ${config.slugPrefix}-${season} já pertence a outra competição`)
  }
  return created
}

export async function batchStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  const batches = []
  for (let i = 0; i < statements.length; i += 100) {
    batches.push(db.batch(statements.slice(i, i + 100)))
  }
  await Promise.all(batches)
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
       logo_url   = excluded.logo_url
     -- Sem mudança, sem gravação (o sync reenvia todos os times a cada tick).
     WHERE teams.logo_url IS NOT excluded.logo_url`,
  )

  for (const team of teamMap.values()) {
    const translated = TEAM_TRANSLATIONS[team.name]
    // Clube brasileiro casa pelo id da football-data; seleção, pelo nome em inglês.
    const club = FOOTBALL_DATA_CLUBS[String(team.id)]
    const finalName = club?.name ?? translated?.name ?? team.name
    const finalShortName =
      club?.shortName ??
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

export type MatchUpsertRow = {
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
  leg: 1 | 2 | null
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

export const KNOCKOUT_STAGES = new Set([
  'PLAYOFFS',
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
])

/** Fases de pontos: o `matchday` é a rodada numérica. */
const LEAGUE_STAGES = new Set(['REGULAR_SEASON', 'GROUP_STAGE', 'LEAGUE_STAGE'])

function mapRound(matchday: number | null, stage: string): string {
  if (KNOCKOUT_STAGES.has(stage) || matchday === null) return stage
  if (!stage || LEAGUE_STAGES.has(stage)) return String(matchday)
  // Em outra fase o matchday recomeça em 1. Sem o prefixo, o jogo entraria na
  // Rodada 1 da fase de pontos.
  return `${stage}_${matchday}`
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
    // A football-data não informa ida e volta: `matchday` não serve para isso
    // (jogo único de mata-mata também vem com matchday 1). O par do confronto é
    // achado pelos times invertidos na mesma fase, em ties.ts.
    leg: null,
    duration: m.score.duration ?? null,
    penaltyWinner: resolvePenaltyWinner(m.score),
    homePenaltyGoals: isShootout ? (m.score.penalties?.home ?? null) : null,
    awayPenaltyGoals: isShootout ? (m.score.penalties?.away ?? null) : null,
    postponed: isPostponed(m.status) ? 1 : 0,
    lockedAt: resolveLockedAt(m.status, now),
  }
}

export const MATCH_UPSERT_SQL = `INSERT INTO matches (
       id, competition_id, external_id, provider, home_team_id, away_team_id,
       start_time, status, home_score, away_score, phase, round, group_name,
       duration, penalty_winner, home_penalty_goals, away_penalty_goals, postponed,
       locked_at, leg
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
       -- O provedor também corrige times, fase e rodada de um jogo já gravado. Com
       -- o mando invertido, o gatilho matches_swap_predictions (migration 0039)
       -- inverte os palpites do jogo na mesma instrução.
       home_team_id       = excluded.home_team_id,
       away_team_id       = excluded.away_team_id,
       phase              = excluded.phase,
       round              = excluded.round,
       group_name         = excluded.group_name,
       leg                = excluded.leg,
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
       -- Quando o jogo corrigido é a ida de um confronto já encerrado, scoring.ts
       -- repontua a volta junto, porque o classificado depende do agregado.
       -- Times e fase também mudam os pontos: o palpite é lido pela posição dos
       -- times, e a fase decide classificado e pênaltis.
       scored_at  = CASE
         WHEN matches.home_score IS NOT excluded.home_score
           OR matches.away_score IS NOT excluded.away_score
           OR matches.penalty_winner IS NOT excluded.penalty_winner
           OR matches.home_team_id IS NOT excluded.home_team_id
           OR matches.away_team_id IS NOT excluded.away_team_id
           OR matches.phase IS NOT excluded.phase
         THEN NULL ELSE matches.scored_at END
     -- Uma resposta atrasada do provedor não pode desfazer um resultado final
     -- (inclusive obtido pelo fallback). Correções finais continuam aceitas.
     WHERE (matches.status != 'finished' OR excluded.status = 'finished')
       -- Só grava quando algum campo do SET muda. O sync reenvia a rodada inteira
       -- a cada tick e quase sempre nada mudou; sem este filtro cada jogo custava
       -- uma gravação da linha e dos índices (~75% das gravações do D1). Cada
       -- linha espelha um campo do SET acima (scored_at só muda junto com placar,
       -- penalty_winner, times ou fase): ao acrescentar um campo no SET, acrescente aqui.
       AND (
         (matches.locked_at IS NULL
           AND (matches.status IN ('live', 'finished') OR excluded.locked_at IS NOT NULL))
         OR matches.home_team_id       IS NOT excluded.home_team_id
         OR matches.away_team_id       IS NOT excluded.away_team_id
         OR matches.phase              IS NOT excluded.phase
         OR matches.round              IS NOT excluded.round
         OR matches.status             IS NOT excluded.status
         OR matches.postponed          IS NOT excluded.postponed
         OR matches.home_score         IS NOT excluded.home_score
         OR matches.away_score         IS NOT excluded.away_score
         OR (excluded.postponed IS NOT 1 AND matches.start_time IS NOT excluded.start_time)
         OR matches.group_name         IS NOT excluded.group_name
         OR matches.leg                IS NOT excluded.leg
         OR matches.duration           IS NOT excluded.duration
         OR matches.penalty_winner     IS NOT excluded.penalty_winner
         OR matches.home_penalty_goals IS NOT excluded.home_penalty_goals
         OR matches.away_penalty_goals IS NOT excluded.away_penalty_goals
       )`

type TeamChange = { externalId: string; kind: 'swap' | 'replace' }

/**
 * Jogos já gravados que o provedor traz com outros times: `swap` quando só o
 * mando inverteu, `replace` quando um time mudou. Precisa ser lido antes do
 * upsert, que grava os times novos.
 */
async function findTeamChanges(
  db: D1Database,
  provider: string,
  rows: MatchUpsertRow[],
): Promise<TeamChange[]> {
  const { results } = await db
    .prepare(
      `SELECT external_id, home_team_id, away_team_id FROM matches
       WHERE provider = ? AND external_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(provider, JSON.stringify(rows.map((row) => row.externalId)))
    .all<{ external_id: string; home_team_id: string; away_team_id: string }>()
  const stored = new Map(results.map((match) => [match.external_id, match]))
  return rows.flatMap((row) => {
    const old = stored.get(row.externalId)
    if (!old || (old.home_team_id === row.homeTeamId && old.away_team_id === row.awayTeamId)) {
      return []
    }
    const swap = old.home_team_id === row.awayTeamId && old.away_team_id === row.homeTeamId
    return [{ externalId: row.externalId, kind: swap ? 'swap' : 'replace' }]
  })
}

/**
 * Grava as linhas com MATCH_UPSERT_SQL e registra `match_teams_changed` para cada
 * jogo que o provedor trouxe com outros times.
 */
export async function writeMatchUpserts(
  db: D1Database,
  statements: D1PreparedStatement[],
  rows: MatchUpsertRow[],
  scope: { ae?: AnalyticsEngineDataset; provider: string; competitionId: string },
): Promise<void> {
  if (statements.length === 0) return
  const changes = await findTeamChanges(db, scope.provider, rows)
  await batchStatements(db, statements)
  for (const change of changes) {
    tryLogEvent(scope.ae, 'match_teams_changed', {
      blobs: [scope.provider, scope.competitionId, change.externalId, change.kind],
    })
  }
}

async function upsertMatches(
  db: D1Database,
  competitionId: string,
  matches: ApiMatch[],
  teamIds: Map<number, string>,
  now: string,
  ae: AnalyticsEngineDataset | undefined,
): Promise<MatchUpsertRow[]> {
  const matchInsertStmt = db.prepare(MATCH_UPSERT_SQL)
  const rows: MatchUpsertRow[] = []
  const matchStatements = []

  for (const m of matches) {
    const row = mapMatchUpsertRow(m, teamIds, now)
    if (!row) continue

    rows.push(row)
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
        row.leg,
        now,
      ),
    )
  }

  await writeMatchUpserts(db, matchStatements, rows, { ae, provider: PROVIDER, competitionId })

  return rows
}

/**
 * Sem `leg`, a pontuação só reconhece a ida pelo par no banco. Uma ida pontuada
 * antes de a volta existir foi tratada como jogo único e recebeu o classificado,
 * que só a volta credita. Quando o par aparece no calendário, a ida que ainda tem
 * classificado volta para a fila de pontuação com `scored_at` nulo, e a pontuação
 * refaz os pontos dela como ida, junto com o ranking. Na ida a pontuação sempre
 * grava classificado zero, então a ida não é reaberta de novo.
 */
async function reopenLeg1ScoredAsSingle(
  db: D1Database,
  competitionId: string,
  rows: MatchUpsertRow[],
): Promise<void> {
  const ties = indexTies(
    rows.map((row) => ({
      id: row.externalId,
      competition_id: competitionId,
      phase: row.phase,
      home_team_id: row.homeTeamId,
      away_team_id: row.awayTeamId,
      start_time: row.startTime,
      leg: row.leg,
    })),
  )
  const leg1Ids = Array.from(ties)
    .filter(([, tie]) => tie.role === 'leg1')
    .map(([externalId]) => externalId)
  if (leg1Ids.length === 0) return

  await db
    .prepare(
      `UPDATE matches SET scored_at = NULL
       WHERE provider = ? AND external_id IN (SELECT value FROM json_each(?))
         AND scored_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM predictions
                     WHERE match_id = matches.id AND classified_points <> 0)`,
    )
    .bind(PROVIDER, JSON.stringify(leg1Ids))
    .run()
}

export async function syncFixtures(opts: SyncOptions): Promise<SyncResult> {
  if (isEspnPrimaryCompetition(opts.competitionCode)) {
    return syncEspnFixtures({
      competitionCode: opts.competitionCode,
      season: opts.season,
      dates: opts.dates,
      db: opts.db,
      now: opts.now,
      onHttpAttempt: opts.onHttpAttempt,
      ae: opts.ae,
    })
  }

  const { competitionCode, season, matchday, apiKey, db } = opts
  if (!apiKey) {
    throw new Error('FOOTBALL_API_KEY não configurada no servidor')
  }

  const data = await fetchMatchesFromApi(
    competitionCode,
    season,
    matchday,
    apiKey,
    opts.onHttpAttempt,
  )
  const { competition: apiComp, matches } = data

  if (matches.length === 0) {
    return {
      competition:
        footballDataCompetitionConfig(apiComp?.code)?.name ?? apiComp?.name ?? competitionCode,
      competitionId: '',
      matches: 0,
      teams: 0,
    }
  }

  const competition = await upsertCompetition(db, apiComp, season, opts.ae)
  const { teamMap, teamIds } = await upsertTeams(db, matches)
  const now = opts.now ?? isoSeconds(new Date())
  const rows = await upsertMatches(db, competition.id, matches, teamIds, now, opts.ae)
  await reopenLeg1ScoredAsSingle(db, competition.id, rows)

  return {
    competition: competition.name,
    competitionId: competition.id,
    matches: rows.length,
    teams: teamMap.size,
  }
}
