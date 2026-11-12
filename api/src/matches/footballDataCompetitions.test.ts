/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { FOOTBALL_DATA_COMPETITIONS } from './footballDataCompetitions'
import { KNOCKOUT_STAGES, syncFixtures } from './sync'

/**
 * O mapa de configuração é o que o sync usa para criar uma competição da
 * football-data. Ele precisa bater com as competições semeadas e com as fases
 * que o importador grava nos jogos de mata-mata.
 */

const HOME = { id: 1, name: 'Time A', shortName: 'A', tla: 'AAA', crest: '' }
const AWAY = { id: 2, name: 'Time B', shortName: 'B', tla: 'BBB', crest: '' }
const SEASON = 2031

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function fdMatch(id: number, stage: string, matchday: number | null) {
  return {
    id,
    utcDate: '2031-06-01T19:00:00Z',
    status: 'TIMED',
    matchday,
    stage,
    group: null,
    homeTeam: HOME,
    awayTeam: AWAY,
    score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null } },
  }
}

function stubCompetition(code: string, id: number, matches: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ competition: { id, code, name: `Nome da API para ${code}` }, matches }),
    ),
  )
}

function migratedDb() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  return { sqlite, db }
}

const entries = Object.entries(FOOTBALL_DATA_COMPETITIONS)

describe('configuração das competições da football-data', () => {
  it('fases de pênaltis são fases de mata-mata, e liga não tem nenhuma', () => {
    for (const [code, config] of entries) {
      for (const phase of config.penaltyPhases) {
        expect(KNOCKOUT_STAGES.has(phase), `${code} ${phase}`).toBe(true)
      }
      if (config.type === 'league') expect(config.penaltyPhases, code).toEqual([])
    }
  })

  it('cada competição semeada pelas migrations bate com a configuração do código', () => {
    const { sqlite } = migratedDb()
    const seeded = sqlite
      .prepare(
        `SELECT external_id, season, name, slug, type, penalty_phases FROM competitions
          WHERE provider = 'football-data'`,
      )
      .all() as Array<Record<string, string>>
    expect(seeded.length).toBeGreaterThan(0)

    for (const row of seeded) {
      const entry = entries.find(([, config]) => String(config.id) === row.external_id)
      expect(entry, `external_id ${row.external_id} sem configuração`).toBeDefined()
      const [, config] = entry!
      expect(row).toEqual({
        external_id: String(config.id),
        season: row.season,
        name: config.name,
        slug: `${config.slugPrefix}-${row.season}`,
        type: config.type,
        penalty_phases: JSON.stringify(config.penaltyPhases),
      })
    }
  })

  it.each(entries)(
    '%s nova nasce em piloto com a configuração e grava as fases de pênaltis nos jogos',
    async (code, config) => {
      const { sqlite, db } = migratedDb()
      // Uma rodada de pontos e um jogo em cada fase de pênaltis configurada.
      const matches = [
        fdMatch(1, 'REGULAR_SEASON', 1),
        ...config.penaltyPhases.map((phase, index) => fdMatch(100 + index, phase, null)),
      ]
      stubCompetition(code, config.id, matches)

      const result = await syncFixtures({ competitionCode: code, season: SEASON, apiKey: 'k', db })

      expect(result).toMatchObject({ competition: config.name, matches: matches.length })
      const row = sqlite
        .prepare(
          `SELECT name, slug, status, type, penalty_phases, visibility FROM competitions WHERE id = ?`,
        )
        .get(result.competitionId)
      expect(row).toEqual({
        name: config.name,
        slug: `${config.slugPrefix}-${SEASON}`,
        status: 'upcoming',
        type: config.type,
        penalty_phases: JSON.stringify(config.penaltyPhases),
        visibility: 'pilot',
      })
      const knockoutPhases = (
        sqlite
          .prepare(
            `SELECT DISTINCT phase FROM matches WHERE competition_id = ? AND phase != 'REGULAR_SEASON'`,
          )
          .all(result.competitionId) as Array<{ phase: string }>
      ).map((match) => match.phase)
      expect(knockoutPhases.sort()).toEqual([...config.penaltyPhases].sort())
    },
  )

  it('slug ocupado por outra competição falha sem gravar nada', async () => {
    const { sqlite, db } = migratedDb()
    sqlite.exec(`INSERT INTO competitions (id, name, slug, external_id, provider, season, status)
      VALUES ('outra', 'Outra', 'premier-league-${SEASON}', 'x', 'espn', '${SEASON}', 'upcoming')`)
    stubCompetition('PL', 2021, [fdMatch(1, 'REGULAR_SEASON', 1)])

    await expect(
      syncFixtures({ competitionCode: 'PL', season: SEASON, apiKey: 'k', db }),
    ).rejects.toThrow('já pertence a outra competição')
    expect(sqlite.prepare(`SELECT COUNT(*) AS total FROM matches`).get()).toEqual({ total: 0 })
  })
})
