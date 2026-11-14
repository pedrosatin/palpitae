/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { readFileSync } from 'node:fs'
import { isKnockoutPhase, KNOCKOUT_PHASES, LABELED_ROUNDS } from './rounds'
import { syncFixtures } from './sync'
import { scoreUnprocessedMatches } from './scoring'

// Sync e pontuação reais sobre o SQLite com todas as migrations aplicadas.

const KICKOFF = '2026-08-01T19:00:00Z'
const BEFORE = '2026-08-01T18:00:00Z'
const DURING = '2026-08-01T20:10:00Z'
const LATER = '2026-08-02T12:00:00Z'
const NEW_DATE = '2026-08-20T19:00:00Z'

function providerMatch(status: string, utcDate = KICKOFF) {
  // Placar parcial no jogo em andamento ou suspenso e placar final no FINISHED,
  // como a football-data manda. Só o FINISHED grava o placar.
  const scored = status === 'SUSPENDED' || status === 'IN_PLAY' || status === 'FINISHED'
  return {
    id: 777001,
    utcDate,
    status,
    matchday: 21,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: { id: 1, name: 'Home FC', shortName: 'Home', tla: 'HOM', crest: 'https://x/1.png' },
    awayTeam: { id: 2, name: 'Away FC', shortName: 'Away', tla: 'AWY', crest: 'https://x/2.png' },
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: scored ? 2 : null, away: scored ? 0 : null },
      halfTime: { home: null, away: null },
    },
  }
}

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const sync = async (status: string, now: string, utcDate = KICKOFF, sameTeam = false) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            competition: { id: 2013, name: 'Campeonato Brasileiro Série A', code: 'BSA' },
            matches: [
              sameTeam
                ? { ...providerMatch(status, utcDate), awayTeam: providerMatch(status).homeTeam }
                : providerMatch(status, utcDate),
            ],
          }
        },
        async text() {
          return ''
        },
      })),
    )
    return syncFixtures({ competitionCode: 'BSA', season: 2026, apiKey: 'k', db, now })
  }
  return { sync, sqlite, db }
}

describe('correções do provedor', () => {
  it('descarta mandante igual ao visitante sem corromper jogo existente', async () => {
    const { sync, sqlite } = setup()
    await sync('FINISHED', DURING)
    const before = sqlite.prepare('SELECT * FROM matches').get()
    const result = await sync('FINISHED', LATER, KICKOFF, true)
    expect(result.discarded).toBe(1)
    expect(sqlite.prepare('SELECT * FROM matches').get()).toEqual(before)
  })

  it('versão sobe com correção e permanece estável no sync sem mudança', async () => {
    const { sync, sqlite } = setup()
    await sync('TIMED', BEFORE)
    const version = () =>
      Number(
        sqlite
          .prepare('SELECT matches_version FROM competitions WHERE external_id = ?')
          .get('2013')!.matches_version,
      )
    const initial = version()
    await sync('TIMED', BEFORE)
    expect(version()).toBe(initial)
    await sync('FINISHED', DURING)
    expect(version()).toBeGreaterThan(initial)
    const final = version()
    await sync('FINISHED', LATER)
    expect(version()).toBe(final)
  })

  it.each(['leg', 'start_time'])('correção de %s devolve o jogo à fila', async (field) => {
    const { sync, sqlite } = setup()
    await sync('FINISHED', DURING)
    sqlite.exec("UPDATE matches SET scored_at = '2026-08-01T22:00:00Z', leg = 1")
    await sync('FINISHED', LATER, field === 'start_time' ? NEW_DATE : KICKOFF)
    expect(sqlite.prepare('SELECT scored_at FROM matches').get()!.scored_at).toBeNull()
  })
})

it('banco recusa mandante igual ao visitante na inserção e na atualização', async () => {
  const { sqlite, sync } = setup()
  await sync('FINISHED', DURING)
  const original = sqlite.prepare('SELECT * FROM matches').get()
  expect(() => sqlite.exec('UPDATE matches SET away_team_id = home_team_id')).toThrow(
    'mandante igual ao visitante',
  )
  expect(sqlite.prepare('SELECT * FROM matches').get()).toEqual(original)
  sqlite.exec(`
    INSERT INTO competitions (id,name,slug,status) VALUES ('c','Copa','copa','ongoing');
    INSERT INTO teams (id,name,slug) VALUES ('t','Time','time');
  `)
  expect(() =>
    sqlite.exec(`INSERT INTO matches
    (id,external_id,provider,competition_id,home_team_id,away_team_id,start_time,status,round)
    VALUES ('m','m','football-data','c','t','t','2026-08-01T19:00:00Z','scheduled','1')`),
  ).toThrow('mandante igual ao visitante')
})

it('mudança de ordem repontua os dois jogos do confronto', async () => {
  const { sync, sqlite, db } = setup()
  await sync('FINISHED', DURING)
  sqlite.exec(`
    UPDATE matches SET phase = 'LAST_16', round = 'LAST_16';
    INSERT INTO matches (id,external_id,provider,competition_id,home_team_id,away_team_id,start_time,status,
      home_score,away_score,round,phase,scored_at)
    SELECT 'return','return','football-data',competition_id,away_team_id,home_team_id,'2026-08-10T19:00:00Z',
      'finished',0,0,'LAST_16','LAST_16','2026-08-10T22:00:00Z' FROM matches;
    UPDATE matches SET scored_at = '2026-08-10T22:00:00Z';
    UPDATE matches SET start_time = '2026-08-20T19:00:00Z' WHERE id != 'return';
  `)
  expect(sqlite.prepare('SELECT scored_at FROM matches').all()).toEqual([
    { scored_at: null },
    { scored_at: null },
  ])
  await scoreUnprocessedMatches(
    String(sqlite.prepare('SELECT competition_id FROM matches').get()!.competition_id),
    db,
  )
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL').get()!.n).toBe(
    0,
  )
})

describe('versão da lista de jogos', () => {
  async function versioned() {
    const { sync, sqlite } = setup()
    await sync('TIMED', BEFORE)
    const version = () =>
      Number(
        sqlite
          .prepare('SELECT matches_version FROM competitions WHERE external_id = ?')
          .get('2013')!.matches_version,
      )
    return { sqlite, version, sync }
  }

  it('sobe com jogo inserido e com jogo excluído', async () => {
    const { sqlite, version } = await versioned()
    const start = version()
    sqlite.exec(`INSERT INTO matches
      (id,external_id,provider,competition_id,home_team_id,away_team_id,start_time,status,round)
      SELECT 'novo','novo','football-data',competition_id,away_team_id,home_team_id,
             '2026-08-10T19:00:00Z','scheduled','22' FROM matches WHERE id != 'novo'`)
    expect(version()).toBe(start + 1)
    sqlite.exec("DELETE FROM matches WHERE id = 'novo'")
    expect(version()).toBe(start + 2)
  })

  it.each([
    ['name', 'Outro nome'],
    ['short_name', 'Outro'],
    ['logo_url', 'https://x/novo.png'],
  ])('sobe com a mudança de %s de um time do jogo', async (column, value) => {
    const { sqlite, version } = await versioned()
    const start = version()
    sqlite.prepare(`UPDATE teams SET ${column} = ? WHERE external_id = '1'`).run(value)
    expect(version()).toBe(start + 1)
  })

  it('sobe com a mudança de penalty_phases', async () => {
    const { sqlite, version } = await versioned()
    const start = version()
    sqlite.exec("UPDATE competitions SET penalty_phases = '[\"FINAL\"]'")
    expect(version()).toBe(start + 1)
  })

  it('não sobe quando só scored_at muda nem quando o sync não muda nada', async () => {
    const { sqlite, version, sync } = await versioned()
    const start = version()
    sqlite.exec("UPDATE matches SET scored_at = '2026-08-01T22:00:00Z'")
    sqlite.exec('UPDATE matches SET scored_at = NULL')
    expect(version()).toBe(start)
    await sync('TIMED', BEFORE)
    expect(version()).toBe(start)
  })
})

describe('repontuação por contexto do confronto', () => {
  const DONE = '2026-08-10T22:00:00Z'

  function pairs(phases: readonly string[]) {
    const { sqlite } = createSqliteD1()
    handles.push(sqlite)
    sqlite.exec("INSERT INTO teams (id,name,slug) VALUES ('a','A','a'),('b','B','b')")
    for (const [index, phase] of phases.entries()) {
      sqlite.exec(`INSERT INTO competitions (id,name,slug,status) VALUES ('c${index}','C','c${index}','ongoing')`)
      sqlite.exec(`INSERT INTO matches
        (id,external_id,provider,competition_id,home_team_id,away_team_id,start_time,status,
         home_score,away_score,round,phase,scored_at)
        VALUES ('first${index}','first${index}','football-data','c${index}','a','b','2026-08-01T19:00:00Z',
                'finished',1,0,'${phase}','${phase}','${DONE}'),
               ('second${index}','second${index}','football-data','c${index}','b','a','2026-08-08T19:00:00Z',
                'finished',0,0,'${phase}','${phase}','${DONE}')`)
    }
    return sqlite
  }

  it('mudar o horário da volta zera o scored_at da ida só em fase eliminatória', () => {
    const phases = [...LABELED_ROUNDS]
    const sqlite = pairs(phases)
    sqlite.exec("UPDATE matches SET start_time = '2026-08-09T19:00:00Z' WHERE id LIKE 'second%'")
    for (const [index, phase] of phases.entries()) {
      const scoredAt = (id: string) =>
        sqlite.prepare('SELECT scored_at FROM matches WHERE id = ?').get(id)!.scored_at
      expect(scoredAt(`second${index}`), `volta ${phase}`).toBeNull()
      expect(scoredAt(`first${index}`), `ida ${phase}`).toBe(isKnockoutPhase(phase) ? null : DONE)
    }
  })

  it('mudar o horário do returno de uma liga mantém o scored_at do turno', () => {
    const sqlite = pairs(['REGULAR_SEASON'])
    sqlite.exec("UPDATE matches SET start_time = '2026-08-09T19:00:00Z' WHERE id = 'second0'")
    expect(sqlite.prepare('SELECT id, scored_at FROM matches ORDER BY id').all()).toEqual([
      { id: 'first0', scored_at: DONE },
      { id: 'second0', scored_at: null },
    ])
  })

  it('mudar o horário da volta de um mata-mata zera o scored_at da ida', () => {
    const sqlite = pairs(['LAST_16'])
    sqlite.exec("UPDATE matches SET start_time = '2026-08-09T19:00:00Z' WHERE id = 'second0'")
    expect(sqlite.prepare('SELECT id, scored_at FROM matches ORDER BY id').all()).toEqual([
      { id: 'first0', scored_at: null },
      { id: 'second0', scored_at: null },
    ])
  })

  it('a lista de fases do gatilho é a de KNOCKOUT_PHASES', () => {
    const sql = readFileSync(
      new URL('../../migrations/0044_matches_version.sql', import.meta.url),
      'utf8',
    )
    const trigger = sql.slice(sql.indexOf('CREATE TRIGGER IF NOT EXISTS matches_rescore_context'))
    const lists = [...trigger.matchAll(/phase IN \(([^)]*)\)/g)].map((match) =>
      [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((phase) => phase[1]),
    )
    expect(lists).toHaveLength(2)
    for (const list of lists) expect([...list].sort()).toEqual([...KNOCKOUT_PHASES].sort())
  })
})
