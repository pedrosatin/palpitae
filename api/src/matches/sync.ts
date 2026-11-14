import type { D1Database } from '@cloudflare/workers-types'
import { runInBatches } from '../d1Batch'
import { tryLogEvent } from '../observability/events'
import { notifyHttpAttempt, type ProviderHttpObserver } from '../observability/providerHttp'
import { FOOTBALL_DATA_CLUBS } from './clubNames'
import { isEspnPrimaryCompetition, syncEspnFixtures } from './espnSync'
import { footballDataCompetitionConfig } from './footballDataCompetitions'
import {
  FD_TIMEOUT_MS,
  noteFootballDataResponse,
  readFootballDataQuota,
  waitForFootballDataQuota,
} from './footballDataQuota'
import {
  countTbdDiscards,
  isoSeconds,
  loadTeamIds,
  type MatchResultFields,
  type MatchUpsertRow,
  NO_RESULT,
  reportDiscards,
  resolveStartTime,
  slugify,
  type SyncDiscard,
  type SyncResult,
  writeMatchUpserts,
} from './matchUpsert'
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
  /**
   * Recebe `match_teams_changed` quando o provedor troca os times de um jogo gravado,
   * `sync_event_discarded` para eventos que o sync não importou e
   * `match_missing_from_feed` para jogos pendentes ausentes do calendário.
   */
  ae?: AnalyticsEngineDataset
  /**
   * Compara o calendário completo da football-data (sem `matchday`) com os jogos
   * pendentes gravados e registra os que sumiram, gastando deste saldo de eventos
   * compartilhado entre as competições da mesma execução. Só a descoberta passa:
   * o poller também busca a temporada inteira em rodadas de mata-mata, a cada
   * 30 minutos.
   */
  missingEvents?: MissingEventBudget
}

/** Saldo de `match_missing_from_feed` que ainda cabe na execução. */
export type MissingEventBudget = { remaining: number }

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
export function resolveCanonicalScore(score: ApiMatch['score']): {
  canonicalHome: number | null
  canonicalAway: number | null
} {
  const fullHome = score.fullTime.home ?? null
  const fullAway = score.fullTime.away ?? null
  if (score.duration !== 'PENALTY_SHOOTOUT') {
    return { canonicalHome: fullHome, canonicalAway: fullAway }
  }

  const rtHome = score.regularTime?.home
  const rtAway = score.regularTime?.away
  if (typeof rtHome === 'number' && typeof rtAway === 'number') {
    return {
      canonicalHome: rtHome + (score.extraTime?.home ?? 0),
      canonicalAway: rtAway + (score.extraTime?.away ?? 0),
    }
  }

  if (fullHome === null || fullAway === null || fullHome === fullAway) {
    return { canonicalHome: fullHome, canonicalAway: fullAway }
  }

  const home = fullHome - (score.penalties?.home ?? 0)
  const away = fullAway - (score.penalties?.away ?? 0)
  // Disputa de pênaltis implica empate. Se a subtração der placar desigual ou
  // negativo, usa o empate não negativo mais plausível.
  if (home < 0 || away < 0 || home !== away) {
    const drawScore = Math.max(0, Math.min(home, away))
    return { canonicalHome: drawScore, canonicalAway: drawScore }
  }
  return { canonicalHome: home, canonicalAway: away }
}

/** Status da football-data.org que encerram o jogo. */
const FINAL_STATUSES = new Set(['FINISHED', 'AWARDED'])

/**
 * Status em que o provider diz que o jogo não vai acontecer no horário marcado.
 * Todos continuam mapeando para `status = 'scheduled'` (o CHECK do schema não
 * comporta outro valor, ver migration 0013) — a flag `postponed` é que carrega
 * a informação para o locking e para a UI. CANCELLED fica junto do adiado porque
 * não é terminal: a football-data já mandou como CANCELLED, com data nova, um
 * jogo suspenso que seria retomado (ver docs/architecture/schema.md).
 */
const POSTPONED_STATUSES = new Set(['POSTPONED', 'SUSPENDED', 'CANCELLED'])

function isPostponed(status: string): boolean {
  return POSTPONED_STATUSES.has(status)
}

/**
 * Status em que o jogo já começou (ou terminou). SUSPENDED entra aqui: o jogo foi
 * interrompido depois do início e o placar parcial já é conhecido, então o palpite
 * tem que continuar travado mesmo com `postponed = 1`. EXTRA_TIME e
 * PENALTY_SHOOTOUT são a prorrogação e os pênaltis em andamento, como o state
 * 'in' da ESPN.
 */
const STARTED_STATUSES = new Set([
  'IN_PLAY',
  'PAUSED',
  'EXTRA_TIME',
  'PENALTY_SHOOTOUT',
  'LIVE',
  'SUSPENDED',
  'FINISHED',
  'AWARDED',
])

/**
 * `locked_at` proposto para a linha: o instante do sync quando o provider indica
 * que o jogo começou. Horário vencido sozinho não conta: um adiamento visto depois
 * do horário original, sem o jogo ter começado, ainda reabre o palpite. O upsert
 * nunca apaga um `locked_at` existente (ver MATCH_UPSERT_SQL).
 */
export function resolveLockedAt(providerStatus: string, now: string): string | null {
  return STARTED_STATUSES.has(providerStatus) ? now : null
}

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
    // Pausa por cota (429 ou cota zerada) vista antes neste isolate: espera ou
    // falha sem request.
    await waitForFootballDataQuota()
    const startedAt = Date.now()
    try {
      const res = await fetch(url.toString(), {
        headers: { 'X-Auth-Token': apiKey },
        signal: AbortSignal.timeout(FD_TIMEOUT_MS),
      })
      const quota = readFootballDataQuota(res.headers, Date.now())
      noteFootballDataResponse(res.status, quota, Date.now())
      notifyHttpAttempt(onAttempt, {
        provider: 'football-data',
        status: res.status,
        durationMs: Date.now() - startedAt,
        quotaRemaining: quota.remaining,
        quotaResetSeconds: quota.resetSeconds,
      })
      return res
    } catch (err) {
      notifyHttpAttempt(onAttempt, {
        provider: 'football-data',
        status: 0,
        durationMs: Date.now() - startedAt,
        // Sem resposta não há cabeçalho de cota: grava -1, como as respostas sem ele.
        quotaRemaining: null,
        quotaResetSeconds: null,
      })
      throw err
    }
  }

  let res = await request()
  // Um único retry, depois do reset que o 429 informou. Reset além de
  // FD_QUOTA_MAX_WAIT_MS falha sem segundo request.
  if (res.status === 429) {
    // O corpo do 429 não é lido: libera a conexão antes do retry.
    await res.body?.cancel()
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

  // Sem alvo no ON CONFLICT: outro sync que tenha criado a mesma competição antes deste
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

/** Teto de `match_missing_from_feed` por competição; o total vai no retorno. */
export const MISSING_EVENTS_PER_COMPETITION = 10

/**
 * Jogos pendentes da competição que o calendário completo da football-data não
 * trouxe: o provedor apagou o jogo ou o reemitiu com outro id, e a linha antiga
 * ficaria `scheduled` para sempre. Só registra (`match_missing_from_feed`); a
 * linha e os palpites ficam, porque o jogo pode voltar no próximo calendário.
 */
async function reportMissingFromFeed(
  db: D1Database,
  competitionId: string,
  matches: ApiMatch[],
  ae: AnalyticsEngineDataset | undefined,
  budget: MissingEventBudget,
): Promise<number> {
  try {
    const { results } = await db
      .prepare(
        `SELECT external_id, start_time FROM matches
          WHERE competition_id = ? AND provider = ? AND status != 'finished'
            AND external_id NOT IN (SELECT value FROM json_each(?))
          ORDER BY start_time, external_id`,
      )
      .bind(competitionId, PROVIDER, JSON.stringify(matches.map((m) => String(m.id))))
      .all<{ external_id: string; start_time: string }>()
    // Leitura e baixa do saldo no mesmo trecho síncrono: competições em paralelo
    // não gastam o mesmo saldo duas vezes.
    const logged = results.slice(0, Math.min(MISSING_EVENTS_PER_COMPETITION, budget.remaining))
    budget.remaining -= logged.length
    for (const match of logged) {
      tryLogEvent(ae, 'match_missing_from_feed', {
        blobs: [PROVIDER, competitionId, match.external_id, match.start_time],
      })
    }
    return results.length
  } catch (err) {
    console.error('[sync] Falha ao conferir jogos ausentes do calendário:', err)
    return 0
  }
}

async function upsertTeams(
  db: D1Database,
  matches: ApiMatch[],
): Promise<{ teamMap: Map<number, ApiTeam>; teamIds: Map<string, string> }> {
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

  await runInBatches(db, teamStatements)

  const teamIds = await loadTeamIds(db, PROVIDER, Array.from(teamMap.keys(), String))
  return { teamMap, teamIds }
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

function mapRound(matchday: number | null, stage: string | null): string | null {
  if ((stage && KNOCKOUT_STAGES.has(stage)) || matchday === null) return stage || null
  if (!stage || LEAGUE_STAGES.has(stage)) return String(matchday)
  // Em outra fase o matchday recomeça em 1. Sem o prefixo, o jogo entraria na
  // Rodada 1 da fase de pontos.
  return `${stage}_${matchday}`
}

function mapMatchUpsertRow(
  m: ApiMatch,
  teamIds: Map<string, string>,
  now: string,
): MatchUpsertRow | SyncDiscard {
  const homeTeamId = teamIds.get(String(m.homeTeam?.id))
  const awayTeamId = teamIds.get(String(m.awayTeam?.id))
  if (!homeTeamId || !awayTeamId) {
    // Sem id de time é confronto ainda indefinido (mata-mata antes do sorteio).
    const tbd = !m.homeTeam?.id || !m.awayTeam?.id
    return { reason: 'missing_competitor', detail: tbd ? 'tbd' : '' }
  }
  if (homeTeamId === awayTeamId) return { reason: 'invalid_event', detail: 'same_team' }
  const startTime = resolveStartTime(m.utcDate)
  if (!startTime) return { reason: 'invalid_event', detail: 'date' }
  const round = mapRound(m.matchday, m.stage)
  if (!round) return { reason: 'invalid_event', detail: 'round' }

  return {
    externalId: String(m.id),
    homeTeamId,
    awayTeamId,
    startTime,
    ...resolveFootballDataResult(m),
    phase: m.stage ?? null,
    round,
    groupName: mapGroupName(m.group),
    // A football-data não informa ida e volta: `matchday` não serve para isso
    // (jogo único de mata-mata também vem com matchday 1). O par do confronto é
    // achado pelos times invertidos na mesma fase, em ties.ts.
    leg: null,
    postponed: isPostponed(m.status) ? 1 : 0,
    lockedAt: resolveLockedAt(m.status, now),
  }
}

/**
 * Resultado só com status final e placar completo, como na ESPN. A football-data
 * manda placar em jogo em andamento (parcial) e em adiado ou cancelado (0-0), e
 * um FINISHED sem placar gravaria `finished` com placar nulo, que a pontuação
 * não alcança. Nesses casos a linha fica sem resultado; o travamento vem de
 * `locked_at`.
 */
function resolveFootballDataResult(m: ApiMatch): MatchResultFields {
  const { canonicalHome, canonicalAway } = resolveCanonicalScore(m.score)
  if (!FINAL_STATUSES.has(m.status) || canonicalHome === null || canonicalAway === null) {
    return NO_RESULT
  }
  const isShootout = m.score.duration === 'PENALTY_SHOOTOUT'
  return {
    status: 'finished',
    homeScore: canonicalHome,
    awayScore: canonicalAway,
    duration: m.score.duration ?? null,
    penaltyWinner: resolvePenaltyWinner(m.score),
    homePenaltyGoals: isShootout ? (m.score.penalties?.home ?? null) : null,
    awayPenaltyGoals: isShootout ? (m.score.penalties?.away ?? null) : null,
  }
}

async function upsertMatches(
  db: D1Database,
  competitionId: string,
  matches: ApiMatch[],
  teamIds: Map<string, string>,
  now: string,
  ae: AnalyticsEngineDataset | undefined,
): Promise<{ rows: MatchUpsertRow[]; discards: SyncDiscard[] }> {
  const rows: MatchUpsertRow[] = []
  const discards: SyncDiscard[] = []

  for (const m of matches) {
    const row = mapMatchUpsertRow(m, teamIds, now)
    if ('reason' in row) discards.push(row)
    else rows.push(row)
  }

  await writeMatchUpserts(db, rows, { provider: PROVIDER, competitionId, now, ae })

  return { rows, discards }
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

/**
 * Syncs fixtures from football-data.org into D1.
 * Upserts: competition, teams, and matches.
 *
 * Copa do Mundo 2026: competitionCode="WC", season=2026
 * First matchday only: matchday=1
 */
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
      discarded: 0,
      discardedTbd: 0,
      missing: 0,
    }
  }

  const competition = await upsertCompetition(db, apiComp, season, opts.ae)
  const { teamMap, teamIds } = await upsertTeams(db, matches)
  const now = opts.now ?? isoSeconds(new Date())
  const { rows, discards } = await upsertMatches(db, competition.id, matches, teamIds, now, opts.ae)
  await reopenLeg1ScoredAsSingle(db, competition.id, rows)
  const discarded = await reportDiscards(db, discards, {
    ae: opts.ae,
    provider: PROVIDER,
    competitionCode,
    season,
    competitionId: competition.id,
  })
  const missing =
    opts.missingEvents && matchday === undefined
      ? await reportMissingFromFeed(db, competition.id, matches, opts.ae, opts.missingEvents)
      : 0

  return {
    competition: competition.name,
    competitionId: competition.id,
    matches: rows.length,
    teams: teamMap.size,
    discarded,
    discardedTbd: countTbdDiscards(discards),
    missing,
  }
}
