/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { FOOTBALL_DATA_CLUBS } from './clubNames'
import { syncFixtures } from './sync'

const MIGRATIONS = new URL('../../migrations/', import.meta.url)
const MIGRATION = '0035_brazilian_club_names.sql'
const ABBREVIATIONS_MIGRATION = '0038_brazilian_club_abbreviations.sql'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function team(id: number, name: string, tla: string) {
  return { id, name, shortName: name, tla, crest: `https://crests.example/${id}.png` }
}

function apiMatch(id: number, home: ReturnType<typeof team>, away: ReturnType<typeof team>) {
  return {
    id,
    utcDate: '2099-05-10T19:00:00Z',
    status: 'TIMED',
    matchday: 1,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: home,
    awayTeam: away,
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
    },
  }
}

function stubFootballData(competition: { id: number; name: string; code: string }, matches: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ competition, matches }), { status: 200 })),
  )
}

function teamsByExternalId(sqlite: DatabaseSync) {
  const rows = sqlite
    .prepare('SELECT external_id, provider, name, short_name, slug FROM teams ORDER BY external_id, provider')
    .all() as { external_id: string; provider: string; name: string; short_name: string; slug: string }[]
  return rows
}

describe('nomes populares dos clubes brasileiros (football-data)', () => {
  it('o sync do Brasileirão grava o nome popular e a sigla do mapa e mantém o slug da API', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    stubFootballData({ id: 2013, name: 'Campeonato Brasileiro Série A', code: 'BSA' }, [
      apiMatch(1, team(1783, 'CR Flamengo', 'FLA'), team(1779, 'SC Corinthians Paulista', 'COR')),
      apiMatch(2, team(1766, 'CA Mineiro', 'CAM'), team(1768, 'CA Paranaense', 'CAP')),
      apiMatch(3, team(4286, 'RB Bragantino', 'RBB'), team(4287, 'Clube do Remo', 'CRE')),
    ])

    await syncFixtures({ competitionCode: 'BSA', season: 2026, apiKey: 'k', db })

    expect(teamsByExternalId(sqlite)).toEqual([
      { external_id: '1766', provider: 'football-data', name: 'Atlético-MG', short_name: 'CAM', slug: 'ca-mineiro' },
      { external_id: '1768', provider: 'football-data', name: 'Athletico-PR', short_name: 'CAP', slug: 'ca-paranaense' },
      { external_id: '1779', provider: 'football-data', name: 'Corinthians', short_name: 'COR', slug: 'sc-corinthians-paulista' },
      { external_id: '1783', provider: 'football-data', name: 'Flamengo', short_name: 'FLA', slug: 'cr-flamengo' },
      { external_id: '4286', provider: 'football-data', name: 'Bragantino', short_name: 'BRA', slug: 'rb-bragantino' },
      { external_id: '4287', provider: 'football-data', name: 'Remo', short_name: 'REMO', slug: 'clube-do-remo' },
    ])
  })

  it('clubes europeus seguem com o nome da API', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    stubFootballData({ id: 2021, name: 'Premier League', code: 'PL' }, [
      apiMatch(10, team(57, 'Arsenal FC', 'ARS'), team(64, 'Liverpool FC', 'LIV')),
    ])

    await syncFixtures({ competitionCode: 'PL', season: 2026, apiKey: 'k', db })

    expect(teamsByExternalId(sqlite).map((t) => t.name)).toEqual(['Arsenal FC', 'Liverpool FC'])
  })

  it('a migration renomeia só os times da football-data e preserva a sigla', () => {
    const sqlite = new DatabaseSync(':memory:')
    handles.push(sqlite)
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files.filter((f) => f < MIGRATION)) {
      sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
    }
    sqlite.exec(`
      INSERT INTO teams (id, name, short_name, slug, external_id, provider) VALUES
        ('fd-fla', 'CR Flamengo', 'FLA', 'cr-flamengo', '1783', 'football-data'),
        ('fd-cam', 'CA Mineiro', 'CAM', 'ca-mineiro', '1766', 'football-data'),
        ('fd-ars', 'Arsenal FC', 'ARS', 'arsenal-fc', '57', 'football-data'),
        ('espn-1783', 'Time ESPN', 'TES', 'time-espn', '1783', 'espn'),
        ('espn-cam', 'Atlético-MG', 'CAM', 'atletico-mg', '7632', 'espn');
    `)

    sqlite.exec(readFileSync(new URL(MIGRATION, MIGRATIONS), 'utf8'))

    const rows = sqlite
      .prepare('SELECT id, name, short_name, slug FROM teams ORDER BY id')
      .all() as { id: string; name: string; short_name: string; slug: string }[]
    expect(rows).toEqual([
      { id: 'espn-1783', name: 'Time ESPN', short_name: 'TES', slug: 'time-espn' },
      { id: 'espn-cam', name: 'Atlético-MG', short_name: 'CAM', slug: 'atletico-mg' },
      { id: 'fd-ars', name: 'Arsenal FC', short_name: 'ARS', slug: 'arsenal-fc' },
      { id: 'fd-cam', name: 'Atlético-MG', short_name: 'CAM', slug: 'ca-mineiro' },
      { id: 'fd-fla', name: 'Flamengo', short_name: 'FLA', slug: 'cr-flamengo' },
    ])
  })

  it('a migration cobre exatamente o mapa do sync', () => {
    const sql = readFileSync(new URL(MIGRATION, MIGRATIONS), 'utf8')
    const updates = Object.fromEntries(
      Array.from(
        sql.matchAll(
          /UPDATE teams SET name = '([^']+)' WHERE provider = 'football-data' AND external_id = '(\d+)';/g,
        ),
        ([, name, externalId]) => [externalId, name],
      ),
    )
    expect(updates).toEqual(
      Object.fromEntries(Object.entries(FOOTBALL_DATA_CLUBS).map(([id, club]) => [id, club.name])),
    )
  })

  it('nenhuma sigla se repete entre os clubes do mapa', () => {
    const siglas = Object.values(FOOTBALL_DATA_CLUBS).map((club) => club.shortName)
    expect(siglas).toHaveLength(20)
    expect(new Set(siglas).size).toBe(siglas.length)
  })

  it('o sync usa a sigla do mapa em vez da tla da API', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    stubFootballData({ id: 2013, name: 'Campeonato Brasileiro Série A', code: 'BSA' }, [
      apiMatch(1, team(4241, 'Coritiba FBC', 'COR'), team(1779, 'SC Corinthians Paulista', 'COR')),
      apiMatch(2, team(1776, 'São Paulo FC', 'PAU'), team(1767, 'Grêmio FBPA', 'FBP')),
      apiMatch(3, team(6684, 'SC Internacional', 'SCI'), team(4287, 'Clube do Remo', 'CRE')),
    ])

    await syncFixtures({ competitionCode: 'BSA', season: 2026, apiKey: 'k', db })

    const siglas = Object.fromEntries(teamsByExternalId(sqlite).map((t) => [t.external_id, t.short_name]))
    expect(siglas).toEqual({
      '1767': 'GRE',
      '1776': 'SAO',
      '1779': 'COR',
      '4241': 'CFC',
      '4287': 'REMO',
      '6684': 'INT',
    })
  })

  it('clubes europeus seguem com a sigla da API', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    stubFootballData({ id: 2021, name: 'Premier League', code: 'PL' }, [
      apiMatch(10, team(57, 'Arsenal FC', 'ARS'), team(64, 'Liverpool FC', 'LIV')),
    ])

    await syncFixtures({ competitionCode: 'PL', season: 2026, apiKey: 'k', db })

    expect(teamsByExternalId(sqlite).map((t) => t.short_name)).toEqual(['ARS', 'LIV'])
  })

  it('a migration de siglas altera só os times brasileiros da football-data e preserva o nome', () => {
    const sqlite = new DatabaseSync(':memory:')
    handles.push(sqlite)
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files.filter((f) => f < ABBREVIATIONS_MIGRATION)) {
      sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
    }
    sqlite.exec(`
      INSERT INTO teams (id, name, short_name, slug, external_id, provider) VALUES
        ('fd-cor', 'Coritiba', 'COR', 'coritiba-fbc', '4241', 'football-data'),
        ('fd-cot', 'Corinthians', 'COR', 'sc-corinthians-paulista', '1779', 'football-data'),
        ('fd-sao', 'São Paulo', 'PAU', 'sao-paulo-fc', '1776', 'football-data'),
        ('fd-ars', 'Arsenal FC', 'ARS', 'arsenal-fc', '57', 'football-data'),
        ('espn-4241', 'Time ESPN', 'TES', 'time-espn', '4241', 'espn');
    `)

    sqlite.exec(readFileSync(new URL(ABBREVIATIONS_MIGRATION, MIGRATIONS), 'utf8'))

    const rows = sqlite
      .prepare('SELECT id, name, short_name FROM teams ORDER BY id')
      .all() as { id: string; name: string; short_name: string }[]
    expect(rows).toEqual([
      { id: 'espn-4241', name: 'Time ESPN', short_name: 'TES' },
      { id: 'fd-ars', name: 'Arsenal FC', short_name: 'ARS' },
      { id: 'fd-cor', name: 'Coritiba', short_name: 'CFC' },
      { id: 'fd-cot', name: 'Corinthians', short_name: 'COR' },
      { id: 'fd-sao', name: 'São Paulo', short_name: 'SAO' },
    ])
  })

  it('a migration de siglas cobre exatamente o mapa do sync', () => {
    const sql = readFileSync(new URL(ABBREVIATIONS_MIGRATION, MIGRATIONS), 'utf8')
    const updates = Object.fromEntries(
      Array.from(
        sql.matchAll(
          /UPDATE teams SET short_name = '([^']+)' WHERE provider = 'football-data' AND external_id = '(\d+)';/g,
        ),
        ([, shortName, externalId]) => [externalId, shortName],
      ),
    )
    expect(updates).toEqual(
      Object.fromEntries(Object.entries(FOOTBALL_DATA_CLUBS).map(([id, club]) => [id, club.shortName])),
    )
  })
})
