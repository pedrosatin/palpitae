/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { discoverFixtures } from './fixtureDiscovery'

/**
 * O provedor corrige times, rodada ou fase de um jogo já gravado. O discovery
 * roda sobre o SQLite das migrations, com o provedor simulado respondendo no
 * formato da football-data, e pontua os jogos encerrados no fim de cada sync.
 */

const PL_ID = '20210000-0000-4000-8000-000000002026'
const CL_ID = '20010000-0000-4000-8000-000000002026'
const ARSENAL = { id: 57, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS', crest: '' }
const CHELSEA = { id: 61, name: 'Chelsea FC', shortName: 'Chelsea', tla: 'CHE', crest: '' }
const BRUGGE = { id: 851, name: 'Club Brugge KV', shortName: 'Club Brugge', tla: 'CLU', crest: '' }
const ATALANTA = { id: 102, name: 'Atalanta BC', shortName: 'Atalanta', tla: 'ATA', crest: '' }

type Team = typeof ARSENAL
type Result = { home: number; away: number; penalties?: { home: number; away: number } }

const KICKOFF = '2026-11-08T16:30:00Z'
const IDA = '2027-02-17T20:00:00Z'
const VOLTA = '2027-02-25T20:00:00Z'
const FINAL = '2027-05-29T19:00:00Z'
const DISCOVERY = Date.parse('2027-03-01T06:00:00Z')

function fdMatch(
  id: number,
  utcDate: string,
  stage: string,
  matchday: number | null,
  home: Team,
  away: Team,
  result?: Result,
) {
  return {
    id,
    utcDate,
    status: result ? 'FINISHED' : 'TIMED',
    matchday,
    stage,
    group: null,
    homeTeam: home,
    awayTeam: away,
    score: !result
      ? { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null } }
      : result.penalties
        ? {
            winner: result.penalties.home > result.penalties.away ? 'HOME_TEAM' : 'AWAY_TEAM',
            duration: 'PENALTY_SHOOTOUT',
            fullTime: {
              home: result.home + result.penalties.home,
              away: result.away + result.penalties.away,
            },
            regularTime: { home: result.home, away: result.away },
            extraTime: { home: 0, away: 0 },
            penalties: result.penalties,
          }
        : {
            winner:
              result.home > result.away
                ? 'HOME_TEAM'
                : result.home < result.away
                  ? 'AWAY_TEAM'
                  : 'DRAW',
            duration: 'REGULAR',
            fullTime: { home: result.home, away: result.away },
          },
  }
}

/** A football-data responde o calendário de cada competição pelo id e nada para o resto. */
function stubProvider() {
  const provider = { pl: [] as ReturnType<typeof fdMatch>[], cl: [] as ReturnType<typeof fdMatch>[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      const code = url.pathname.split('/')[3]
      const name = code === '2021' ? 'Premier League' : 'UEFA Champions League'
      const matches = code === '2021' ? provider.pl : code === '2001' ? provider.cl : []
      return Response.json({ competition: { id: Number(code), code, name }, matches })
    }),
  )
  return provider
}

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id) VALUES
      ('u-ana', 'ana@palpitae.com', 'google', 'g-ana'),
      ('u-beto', 'beto@palpitae.com', 'google', 'g-beto');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code,
                        points_exact, points_winner, points_penalty, points_classified)
      VALUES ('g-pl', 'Bolão Premier', '${PL_ID}', 'u-ana', 'INVPL', 3, 1, 0, 0),
             ('g-cl', 'Bolão Champions', '${CL_ID}', 'u-ana', 'INVCL', 3, 1, 1, 2);
    INSERT INTO group_members (id, group_id, user_id)
      SELECT g.id || u.id, g.id, u.id FROM groups g, users u;
  `)
  const ae = { writeDataPoint: vi.fn() }
  const discover = () =>
    discoverFixtures(db, 'test', ae as unknown as AnalyticsEngineDataset, DISCOVERY)
  return { sqlite, ae, discover, provider: stubProvider() }
}

/** Grava o palpite pelo id externo da football-data. */
function predict(
  sqlite: DatabaseSync,
  groupId: string,
  userId: string,
  externalId: number,
  home: number,
  away: number,
  penaltyWinner: 'home' | 'away' | null = null,
) {
  sqlite
    .prepare(
      `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score,
                                predicted_away_score, predicted_penalty_winner)
       SELECT ?, ?, ?, id, ?, ?, ? FROM matches WHERE external_id = ?`,
    )
    .run(
      `${userId}-${externalId}`,
      userId,
      groupId,
      home,
      away,
      penaltyWinner,
      String(externalId),
    )
}

/** Jogo como a tela mostra: mandante, placar e visitante, com rodada, fase e pontuação. */
function readMatch(sqlite: DatabaseSync, externalId: number) {
  return sqlite
    .prepare(
      `SELECT ht.short_name || ' ' || COALESCE(m.home_score, '-') || 'x' ||
                COALESCE(m.away_score, '-') || ' ' || at.short_name AS game,
              m.round, m.phase, m.scored_at IS NOT NULL AS scored
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.external_id = ?`,
    )
    .get(String(externalId))
}

/**
 * Palpite como a tela mostra, com os times do jogo no lugar de casa e fora e o
 * time previsto nos pênaltis, e os pontos no formato placar+pênaltis+classificado.
 * Mais o total de cada um no ranking.
 */
function readPicks(sqlite: DatabaseSync, groupId: string) {
  const picks = sqlite
    .prepare(
      `SELECT p.user_id || ':' || m.external_id AS pick,
              ht.short_name || ' ' || p.predicted_home_score || 'x' ||
                p.predicted_away_score || ' ' || at.short_name ||
                CASE p.predicted_penalty_winner
                  WHEN 'home' THEN ' (pên. ' || ht.short_name || ')'
                  WHEN 'away' THEN ' (pên. ' || at.short_name || ')'
                  ELSE '' END || ' = ' ||
                p.points_awarded || '+' || p.penalty_points || '+' || p.classified_points AS value
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE p.group_id = ? ORDER BY pick`,
    )
    .all(groupId) as { pick: string; value: string }[]
  const ranking = sqlite
    .prepare(`SELECT user_id, total_points FROM leaderboard WHERE group_id = ? ORDER BY user_id`)
    .all(groupId) as { user_id: string; total_points: number }[]
  return {
    picks: Object.fromEntries(picks.map((row) => [row.pick, row.value])),
    ranking: Object.fromEntries(ranking.map((row) => [row.user_id, row.total_points])),
  }
}

describe('provedor corrige o mando de um jogo já pontuado', () => {
  it('o jogo passa a ter os times novos, o palpite acompanha os times e a pontuação é refeita pelo placar certo', async () => {
    const { sqlite, discover, provider } = setup()
    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 11, ARSENAL, CHELSEA)]
    await discover()
    // Ana aposta no Chelsea por 2x1, Beto no Arsenal por 1x0.
    predict(sqlite, 'g-pl', 'u-ana', 9001, 1, 2)
    predict(sqlite, 'g-pl', 'u-beto', 9001, 1, 0)

    // O Chelsea vence por 2x1 e o provedor ainda traz o Arsenal como mandante.
    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 11, ARSENAL, CHELSEA, { home: 1, away: 2 })]
    await discover()
    expect(readMatch(sqlite, 9001)).toMatchObject({ game: 'ARS 1x2 CHE', scored: 1 })
    expect(readPicks(sqlite, 'g-pl')).toEqual({
      picks: { 'u-ana:9001': 'ARS 1x2 CHE = 3+0+0', 'u-beto:9001': 'ARS 1x0 CHE = 0+0+0' },
      ranking: { 'u-ana': 3, 'u-beto': 0 },
    })

    // O provedor corrige o mando: o jogo foi em Stamford Bridge. O resultado é o
    // mesmo, Chelsea 2x1, agora com o Chelsea como mandante.
    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 11, CHELSEA, ARSENAL, { home: 2, away: 1 })]
    await discover()
    const corrected = {
      picks: { 'u-ana:9001': 'CHE 2x1 ARS = 3+0+0', 'u-beto:9001': 'CHE 0x1 ARS = 0+0+0' },
      ranking: { 'u-ana': 3, 'u-beto': 0 },
    }
    expect(readMatch(sqlite, 9001)).toMatchObject({ game: 'CHE 2x1 ARS', scored: 1 })
    expect(readPicks(sqlite, 'g-pl')).toEqual(corrected)

    // Um novo sync com o mesmo calendário não inverte os palpites de novo.
    await discover()
    expect(readMatch(sqlite, 9001)).toMatchObject({ game: 'CHE 2x1 ARS', scored: 1 })
    expect(readPicks(sqlite, 'g-pl')).toEqual(corrected)
  })

  it('com o mesmo placar na nova ordem, a troca de mando sozinha refaz a pontuação e registra o evento', async () => {
    const { sqlite, ae, discover, provider } = setup()
    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 11, ARSENAL, CHELSEA)]
    await discover()
    predict(sqlite, 'g-pl', 'u-ana', 9001, 2, 1)
    predict(sqlite, 'g-pl', 'u-beto', 9001, 1, 2)

    // Primeiro o provedor publica Arsenal 2x1 em casa.
    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 11, ARSENAL, CHELSEA, { home: 2, away: 1 })]
    await discover()
    expect(readPicks(sqlite, 'g-pl').ranking).toEqual({ 'u-ana': 3, 'u-beto': 0 })

    // A correção: o jogo foi no Chelsea, que venceu por 2x1. Os números do placar
    // não mudam, só os times.
    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 11, CHELSEA, ARSENAL, { home: 2, away: 1 })]
    ae.writeDataPoint.mockClear()
    await discover()
    expect(readMatch(sqlite, 9001)).toMatchObject({ game: 'CHE 2x1 ARS', scored: 1 })
    expect(readPicks(sqlite, 'g-pl')).toEqual({
      picks: { 'u-ana:9001': 'CHE 1x2 ARS = 0+0+0', 'u-beto:9001': 'CHE 2x1 ARS = 3+0+0' },
      ranking: { 'u-ana': 0, 'u-beto': 3 },
    })
    const teamEvents = ae.writeDataPoint.mock.calls
      .map(([point]) => point.blobs)
      .filter((blobs: string[]) => blobs[0] === 'match_teams_changed')
    expect(teamEvents).toEqual([['match_teams_changed', 'football-data', PL_ID, '9001', 'swap']])

    // Sem mudança no provedor, nenhum evento novo.
    ae.writeDataPoint.mockClear()
    await discover()
    expect(
      ae.writeDataPoint.mock.calls.filter(([point]) => point.blobs[0] === 'match_teams_changed'),
    ).toEqual([])
  })
})

describe('provedor corrige o mando da ida de um mata-mata', () => {
  it('a ida e a volta passam a formar o confronto e o classificado é creditado uma vez, pelo agregado', async () => {
    const { sqlite, discover, provider } = setup()
    // O provedor publica a ida com o mando errado: Atalanta em casa nos dois jogos.
    // Sem times invertidos não há confronto, e cada jogo vale como jogo único.
    const ida = (home: Team, away: Team, r?: Result) =>
      fdMatch(5001, IDA, 'PLAYOFFS', 1, home, away, r)
    const volta = (r?: Result) => fdMatch(5002, VOLTA, 'PLAYOFFS', 2, ATALANTA, BRUGGE, r)
    provider.cl = [ida(ATALANTA, BRUGGE), volta()]
    await discover()
    // Ana aposta no Brugge por 2x0 na ida e no empate em 1x1 na volta.
    predict(sqlite, 'g-cl', 'u-ana', 5001, 0, 2)
    predict(sqlite, 'g-cl', 'u-ana', 5002, 1, 1)

    // A ida termina com vitória do Brugge por 2x1, ainda com o mando errado.
    provider.cl = [ida(ATALANTA, BRUGGE, { home: 1, away: 2 }), volta()]
    await discover()
    expect(readPicks(sqlite, 'g-cl')).toEqual({
      picks: { 'u-ana:5001': 'ATA 0x2 CLU = 1+0+2', 'u-ana:5002': 'ATA 1x1 CLU = 0+0+0' },
      ranking: { 'u-ana': 3 },
    })

    // O provedor corrige o mando da ida. Agora ida e volta formam o confronto, e
    // a ida deixa de pagar o classificado.
    provider.cl = [ida(BRUGGE, ATALANTA, { home: 2, away: 1 }), volta()]
    await discover()
    expect(readMatch(sqlite, 5001)).toMatchObject({ game: 'CLU 2x1 ATA', scored: 1 })
    expect(readPicks(sqlite, 'g-cl')).toEqual({
      picks: { 'u-ana:5001': 'CLU 2x0 ATA = 1+0+0', 'u-ana:5002': 'ATA 1x1 CLU = 0+0+0' },
      ranking: { 'u-ana': 1 },
    })

    // A volta termina 1x1: o Brugge passa por 3x2 no agregado, como Ana previu.
    provider.cl = [ida(BRUGGE, ATALANTA, { home: 2, away: 1 }), volta({ home: 1, away: 1 })]
    await discover()
    const decided = {
      picks: { 'u-ana:5001': 'CLU 2x0 ATA = 1+0+0', 'u-ana:5002': 'ATA 1x1 CLU = 3+0+2' },
      ranking: { 'u-ana': 6 },
    }
    expect(readPicks(sqlite, 'g-cl')).toEqual(decided)
    await discover()
    expect(readPicks(sqlite, 'g-cl')).toEqual(decided)
  })
})

describe('provedor corrige o mandante de uma final em jogo único', () => {
  it('o time previsto nos pênaltis acompanha o mando e recebe o bônus e o classificado', async () => {
    const { sqlite, discover, provider } = setup()
    const final = (home: Team, away: Team, r?: Result) =>
      fdMatch(5005, FINAL, 'FINAL', 1, home, away, r)
    provider.cl = [final(BRUGGE, ATALANTA)]
    await discover()
    // Ana aposta no empate em 1x1 com o Brugge nos pênaltis.
    predict(sqlite, 'g-cl', 'u-ana', 5005, 1, 1, 'home')

    // O provedor troca o mandante da final e publica o resultado: 1x1 e o Brugge
    // vence nos pênaltis.
    provider.cl = [final(ATALANTA, BRUGGE, { home: 1, away: 1, penalties: { home: 3, away: 4 } })]
    await discover()
    expect(readMatch(sqlite, 5005)).toMatchObject({ game: 'ATA 1x1 CLU', scored: 1 })
    expect(readPicks(sqlite, 'g-cl')).toEqual({
      picks: { 'u-ana:5005': 'ATA 1x1 CLU (pên. CLU) = 3+1+2' },
      ranking: { 'u-ana': 6 },
    })
  })
})

describe('provedor corrige rodada ou fase', () => {
  it('o jogo muda de rodada e de fase junto com o provedor', async () => {
    const { sqlite, discover, provider } = setup()
    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 11, ARSENAL, CHELSEA)]
    provider.cl = [fdMatch(5001, IDA, 'LEAGUE_STAGE', 8, BRUGGE, ATALANTA)]
    await discover()
    expect(readMatch(sqlite, 9001)).toMatchObject({ round: '11', phase: 'REGULAR_SEASON' })
    expect(readMatch(sqlite, 5001)).toMatchObject({ round: '8', phase: 'LEAGUE_STAGE' })

    provider.pl = [fdMatch(9001, KICKOFF, 'REGULAR_SEASON', 12, ARSENAL, CHELSEA)]
    provider.cl = [fdMatch(5001, IDA, 'PLAYOFFS', 1, BRUGGE, ATALANTA)]
    await discover()
    expect(readMatch(sqlite, 9001)).toMatchObject({ round: '12', phase: 'REGULAR_SEASON' })
    expect(readMatch(sqlite, 5001)).toMatchObject({ round: 'PLAYOFFS', phase: 'PLAYOFFS' })
  })

  it('a rodada de uma fase fora da fase de liga não entra na rodada numérica de mesmo número', async () => {
    const { sqlite, discover, provider } = setup()
    provider.cl = [
      fdMatch(5001, IDA, 'LEAGUE_STAGE', 1, BRUGGE, ATALANTA),
      fdMatch(5002, VOLTA, 'PLAYOFF_ROUND_1', 1, ATALANTA, BRUGGE),
    ]
    await discover()
    expect(readMatch(sqlite, 5001)).toMatchObject({ round: '1', phase: 'LEAGUE_STAGE' })
    expect(readMatch(sqlite, 5002)).toMatchObject({
      round: 'PLAYOFF_ROUND_1_1',
      phase: 'PLAYOFF_ROUND_1',
    })
  })
})
