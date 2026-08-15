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

  // Fuzzy lookup: a API manda "FIFA World Cup", o mapa tem a chave "World Cup".
  // includes() casa sem precisar duplicar variações da chave no mapa.
  const translationKey = apiComp
    ? Object.keys(COMP_TRANSLATIONS).find((key) => apiComp.name.includes(key))
    : undefined
  const competitionName = apiComp
    ? translationKey
      ? COMP_TRANSLATIONS[translationKey]
      : apiComp.name
    : competitionCode

  if (matches.length === 0) {
    return {
      competition: competitionName,
      competitionId: '',
      matches: 0,
      teams: 0,
    }
  }

  const competitionExternalId = String(apiComp.id)
  // Slug deriva do nome CRU da API (não do traduzido) p/ ficar estável: mudar a
  // tradução de exibição não pode mudar a chave de conflito do upsert, senão um
  // re-sync criaria uma competição duplicada (slug = 'fifa-world-cup-2026' em prod).
  const competitionSlug = slugify(`${apiComp.name}-${season}`)

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
    await db.batch(teamStatements)
  }

  // Resolve internal team IDs
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

  // Upsert matches
  let matchCount = 0
  const matchStatements = []
  const matchInsertStmt = db.prepare(
    `INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration, penalty_winner, home_penalty_goals, away_penalty_goals, postponed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id, provider) DO UPDATE SET
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
         THEN NULL ELSE matches.scored_at END`,
  )

  for (const m of matches) {
    const homeTeamId = teamIds.get(m.homeTeam?.id)
    const awayTeamId = teamIds.get(m.awayTeam?.id)
    if (!homeTeamId || !awayTeamId) continue

    const status = mapStatus(m.status)
    const postponed = isPostponed(m.status) ? 1 : 0
    const phase = m.stage ?? null
    const round = m.matchday !== null ? String(m.matchday) : m.stage
    const groupName = m.group ? m.group.replace(/^GROUP_/, '') : null

    // Placar canônico = o que o palpite compara (tempo regulamentar + prorrogação,
    // SEM pênaltis). Em PENALTY_SHOOTOUT o fullTime da football-data às vezes INCLUI os
    // gols de pênalti, e outras vezes não (além de regularTime e extraTime ocasionalmente
    // virem nulos).
    //
    // Estratégia (prioridade decrescente):
    // 1. Se regularTime está disponível (não-null): canonicalScore = regularTime + extraTime.
    //    Esses campos NUNCA incluem gols de pênalti e são a fonte mais confiável.
    // 2. Se regularTime é null (provider omitiu) e fullTime é diferente: subtrai os gols
    //    de pênalti de fullTime. Essa heurística assume que o provider embutiu os pênaltis
    //    em fullTime — o que só acontece quando os valores são desiguais.
    // 3. fullTime igual: já é o placar do empate, não faz nada.
    const { canonicalHome, canonicalAway } = resolveCanonicalScore(m.score)

    const isShootout = m.score.duration === 'PENALTY_SHOOTOUT'
    const duration = m.score.duration ?? null
    // Vencedor dos pênaltis só faz sentido em PENALTY_SHOOTOUT (score.winner também
    // vem preenchido em jogos REGULAR, onde significa o vencedor no tempo normal).
    // Se o provider mandar winner como null (comum em empates com disputa de pênaltis
    // concluída), derivamos pelo placar da DISPUTA (score.penalties) — fonte canônica
    // e que nunca empata. NÃO derivar de fullTime: quando o provider manda winner null
    // ele também devolve fullTime = placar do tempo normal (empate), o que faria a
    // derivação retornar null e zerar o bônus de pênalti de quem acertou.
    const penaltyWinner = isShootout
      ? m.score.winner === 'HOME_TEAM'
        ? 'home'
        : m.score.winner === 'AWAY_TEAM'
          ? 'away'
          : (m.score.penalties?.home ?? 0) > (m.score.penalties?.away ?? 0)
            ? 'home'
            : (m.score.penalties?.home ?? 0) < (m.score.penalties?.away ?? 0)
              ? 'away'
              : null
      : null
    const homePenaltyGoals = isShootout ? (m.score.penalties?.home ?? null) : null
    const awayPenaltyGoals = isShootout ? (m.score.penalties?.away ?? null) : null

    matchStatements.push(
      matchInsertStmt.bind(
        crypto.randomUUID(),
        competition.id,
        String(m.id),
        PROVIDER,
        homeTeamId,
        awayTeamId,
        m.utcDate,
        status,
        canonicalHome,
        canonicalAway,
        phase,
        round,
        groupName,
        duration,
        penaltyWinner,
        homePenaltyGoals,
        awayPenaltyGoals,
        postponed,
      ),
    )

    matchCount++
  }

  if (matchStatements.length > 0) {
    await db.batch(matchStatements)
  }

  return {
    competition: competitionName,
    competitionId: competition.id,
    matches: matchCount,
    teams: teamMap.size,
  }
}
