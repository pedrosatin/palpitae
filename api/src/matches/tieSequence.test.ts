/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'

/**
 * Mata-mata da Liga dos Campeões pela football-data, que não informa ida e
 * volta. O discovery e o poller rodam sobre o SQLite das migrations, e o
 * provedor simulado responde o calendário de cada etapa.
 */

const CL_ID = '20010000-0000-4000-8000-000000002026'
const TBD = { id: null, name: null, shortName: null, tla: null, crest: null }
const BRUGGE = { id: 851, name: 'Club Brugge KV', shortName: 'Club Brugge', tla: 'CLU', crest: '' }
const ATALANTA = { id: 102, name: 'Atalanta BC', shortName: 'Atalanta', tla: 'ATA', crest: '' }
const BENFICA = {
  id: 1903,
  name: 'Sport Lisboa e Benfica',
  shortName: 'Benfica',
  tla: 'BEN',
  crest: '',
}
const JUVENTUS = { id: 109, name: 'Juventus FC', shortName: 'Juventus', tla: 'JUV', crest: '' }

type Team = typeof BRUGGE | typeof TBD
type Score = { home: number; away: number; penalties?: { home: number; away: number } }

const IDA = '2027-02-17T20:00:00Z'
const VOLTA = '2027-02-25T20:00:00Z'
const FINAL = '2027-05-29T19:00:00Z'
/** Instante dentro da janela ativa do poller, entre 115 e 200 min após o início. */
const afterKickoff = (kickoff: string) => Date.parse(kickoff) + 120 * 60_000
const DISCOVERY_FEB_10 = Date.parse('2027-02-10T06:00:00Z')
const DISCOVERY_FEB_18 = Date.parse('2027-02-18T06:00:00Z')
const DISCOVERY_MAY_20 = Date.parse('2027-05-20T06:00:00Z')

/** A football-data manda `matchday` 2 na volta do mata-mata e 1 nos outros jogos, como em tieClassified.test.ts. */
function fdMatch(
  id: number,
  utcDate: string,
  stage: string,
  home: Team,
  away: Team,
  result?: Score,
  matchday = 1,
) {
  const penalties = result?.penalties
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
      : penalties
        ? {
            winner: penalties.home > penalties.away ? 'HOME_TEAM' : 'AWAY_TEAM',
            duration: 'PENALTY_SHOOTOUT',
            fullTime: {
              home: result.home + penalties.home,
              away: result.away + penalties.away,
            },
            regularTime: { home: result.home, away: result.away },
            extraTime: { home: 0, away: 0 },
            penalties,
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

/** A football-data responde `provider.matches` para a Liga dos Campeões e nada para o resto. */
function stubProvider() {
  const provider = { matches: [] as ReturnType<typeof fdMatch>[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      const code = url.pathname.split('/')[3]
      return Response.json({
        competition: { id: Number(code), code, name: 'UEFA Champions League' },
        matches: code === '2001' ? provider.matches : [],
      })
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
      VALUES ('g1', 'Bolão Champions', '${CL_ID}', 'u-ana', 'INVCL', 3, 1, 1, 2);
    INSERT INTO group_members (id, group_id, user_id) SELECT id, 'g1', id FROM users;
  `)
  return { sqlite, db, provider: stubProvider() }
}

/** Grava o palpite pelo id externo da football-data. */
function predict(
  sqlite: DatabaseSync,
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
       SELECT ?, ?, 'g1', id, ?, ?, ? FROM matches WHERE external_id = ?`,
    )
    .run(`${userId}-${externalId}`, userId, home, away, penaltyWinner, String(externalId))
}

/** Pontos de cada palpite no formato placar+pênaltis+classificado, e o total de cada usuário no ranking. */
function readState(sqlite: DatabaseSync) {
  const points = sqlite
    .prepare(
      `SELECT p.user_id || ':' || m.external_id AS pick,
              p.points_awarded || '+' || p.penalty_points || '+' || p.classified_points AS points
       FROM predictions p JOIN matches m ON m.id = p.match_id ORDER BY pick`,
    )
    .all() as { pick: string; points: string }[]
  const ranking = sqlite
    .prepare(`SELECT user_id, total_points FROM leaderboard ORDER BY user_id`)
    .all() as { user_id: string; total_points: number }[]
  return {
    points: Object.fromEntries(points.map((row) => [row.pick, row.points])),
    ranking: Object.fromEntries(ranking.map((row) => [row.user_id, row.total_points])),
  }
}

describe('pontos de classificado por confronto no mata-mata da football-data', () => {
  it('ida, pontuação, descoberta da volta e fim do confronto creditam o classificado uma vez, e reprocessar não muda os totais', async () => {
    const { sqlite, db, provider } = setup()
    // No confronto A, decidido no agregado, a football-data ainda não definiu os
    // times da volta. O confronto B, decidido nos pênaltis, tem ida e volta
    // publicadas juntas. A final é jogo único.
    const idaA = (r?: Score) => fdMatch(5001, IDA, 'PLAYOFFS', BRUGGE, ATALANTA, r)
    const voltaA = (home: Team, away: Team, r?: Score) =>
      fdMatch(5002, VOLTA, 'PLAYOFFS', home, away, r, 2)
    const idaB = (r?: Score) => fdMatch(5003, IDA, 'PLAYOFFS', BENFICA, JUVENTUS, r)
    const voltaB = (r?: Score) => fdMatch(5004, VOLTA, 'PLAYOFFS', JUVENTUS, BENFICA, r, 2)
    const final = (home: Team, away: Team, r?: Score) =>
      fdMatch(5005, FINAL, 'FINAL', home, away, r)

    // Etapa 1: o discovery carrega as idas e a volta B. A volta A e a final vêm
    // sem times e ficam de fora.
    provider.matches = [idaA(), voltaA(TBD, TBD), idaB(), voltaB(), final(TBD, TBD)]
    await discoverFixtures(db, 'test', undefined, DISCOVERY_FEB_10)
    expect(sqlite.prepare('SELECT external_id FROM matches ORDER BY 1').all()).toEqual([
      { external_id: '5001' },
      { external_id: '5003' },
      { external_id: '5004' },
    ])
    predict(sqlite, 'u-ana', 5001, 2, 1)
    predict(sqlite, 'u-beto', 5001, 3, 0)
    predict(sqlite, 'u-ana', 5003, 1, 0)
    predict(sqlite, 'u-beto', 5003, 0, 2)
    predict(sqlite, 'u-ana', 5004, 1, 0, 'away')
    predict(sqlite, 'u-beto', 5004, 2, 0)

    // Etapa 2: as idas terminam e o poller pontua. Sem a volta no banco, a ida A
    // não se distingue de um jogo único e recebe o classificado de jogo único.
    // A ida B já tem a volta no banco e não recebe.
    provider.matches = [
      idaA({ home: 2, away: 1 }),
      voltaA(TBD, TBD),
      idaB({ home: 1, away: 0 }),
      voltaB(),
      final(TBD, TBD),
    ]
    await pollActiveMatches(db, 'test', undefined, afterKickoff(IDA))
    const afterLeg1 = {
      points: {
        'u-ana:5001': '3+0+2',
        'u-ana:5003': '3+0+0',
        'u-ana:5004': '0+0+0',
        'u-beto:5001': '1+0+2',
        'u-beto:5003': '0+0+0',
        'u-beto:5004': '0+0+0',
      },
      ranking: { 'u-ana': 8, 'u-beto': 3 },
    }
    expect(readState(sqlite)).toEqual(afterLeg1)
    await pollActiveMatches(db, 'test', undefined, afterKickoff(IDA))
    await discoverFixtures(db, 'test', undefined, afterKickoff(IDA))
    expect(readState(sqlite)).toEqual(afterLeg1)

    // Etapa 3: o discovery encontra a volta A. A ida A deixa de ser jogo único e
    // perde o classificado; o confronto ainda não foi decidido.
    provider.matches[1] = voltaA(ATALANTA, BRUGGE)
    await discoverFixtures(db, 'test', undefined, DISCOVERY_FEB_18)
    const leg2Found = {
      points: { ...afterLeg1.points, 'u-ana:5001': '3+0+0', 'u-beto:5001': '1+0+0' },
      ranking: { 'u-ana': 6, 'u-beto': 1 },
    }
    expect(readState(sqlite)).toEqual(leg2Found)
    await discoverFixtures(db, 'test', undefined, DISCOVERY_FEB_18)
    expect(readState(sqlite)).toEqual(leg2Found)

    // Etapa 4: as voltas terminam. No A, o 1x1 classifica o Brugge por 3x2 no
    // agregado. No B, a Juventus vence por 1x0, empata o agregado e o Benfica
    // avança nos pênaltis.
    predict(sqlite, 'u-ana', 5002, 1, 1)
    predict(sqlite, 'u-beto', 5002, 4, 0)
    provider.matches[1] = voltaA(ATALANTA, BRUGGE, { home: 1, away: 1 })
    provider.matches[3] = voltaB({ home: 1, away: 0, penalties: { home: 3, away: 4 } })
    await pollActiveMatches(db, 'test', undefined, afterKickoff(VOLTA))
    const tiesDecided = {
      points: {
        ...leg2Found.points,
        'u-ana:5002': '3+0+2',
        'u-ana:5004': '3+1+2',
        'u-beto:5002': '0+0+0',
        'u-beto:5004': '1+0+0',
      },
      ranking: { 'u-ana': 17, 'u-beto': 2 },
    }
    expect(readState(sqlite)).toEqual(tiesDecided)
    await pollActiveMatches(db, 'test', undefined, afterKickoff(VOLTA))
    await discoverFixtures(db, 'test', undefined, afterKickoff(VOLTA))
    expect(readState(sqlite)).toEqual(tiesDecided)

    // Etapa 5: a final, jogo único, termina 2x2 e o Brugge vence nos pênaltis.
    provider.matches[4] = final(BRUGGE, BENFICA)
    await discoverFixtures(db, 'test', undefined, DISCOVERY_MAY_20)
    predict(sqlite, 'u-ana', 5005, 1, 1, 'home')
    predict(sqlite, 'u-beto', 5005, 2, 1)
    provider.matches[4] = final(BRUGGE, BENFICA, {
      home: 2,
      away: 2,
      penalties: { home: 5, away: 4 },
    })
    await pollActiveMatches(db, 'test', undefined, afterKickoff(FINAL))
    const finalDecided = {
      points: { ...tiesDecided.points, 'u-ana:5005': '1+1+2', 'u-beto:5005': '0+0+2' },
      ranking: { 'u-ana': 21, 'u-beto': 4 },
    }
    expect(readState(sqlite)).toEqual(finalDecided)
    await pollActiveMatches(db, 'test', undefined, afterKickoff(FINAL))
    await discoverFixtures(db, 'test', undefined, afterKickoff(FINAL))
    expect(readState(sqlite)).toEqual(finalDecided)
  })
})
