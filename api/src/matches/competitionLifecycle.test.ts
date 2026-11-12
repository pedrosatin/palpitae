/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync', () => ({ syncFixtures: vi.fn(async () => undefined) }))
vi.mock('./scoring', () => ({ scoreUnprocessedMatches: vi.fn(async () => undefined) }))

import { competitionStatusSql } from '../groups/competitionStatus'
import { createSqliteD1 } from '../testing/sqliteD1'
import { FINISH_CONFIRMATION_DAYS, reconcileCompetitionStatus } from './competitionLifecycle'
import { discoverFixtures } from './fixtureDiscovery'
import { syncFixtures } from './sync'

const syncMock = vi.mocked(syncFixtures)
const DAY = 86_400_000
// A projeção da tela usa o relógio do SQLite; os dias do teste partem do mesmo agora.
const NOW = Date.now()

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

type Competition = {
  id: string
  provider: 'football-data' | 'espn'
  type: 'cup' | 'league'
  status?: 'upcoming' | 'ongoing' | 'finished'
  visibility?: 'public' | 'pilot'
}

type Match = {
  id: string
  start: number
  status: 'scheduled' | 'live' | 'finished'
  phase?: string
  leg?: 1 | 2 | null
}

function openDb() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    DELETE FROM competitions;
    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras');
  `)

  function addCompetition(comp: Competition) {
    sqlite
      .prepare(
        `INSERT INTO competitions
           (id, name, slug, external_id, provider, season, status, type, penalty_phases, visibility)
         VALUES (?, ?, ?, ?, ?, '2026', ?, ?, '[]', ?)`,
      )
      .run(
        comp.id,
        comp.id,
        comp.id,
        `ext-${comp.id}`,
        comp.provider,
        comp.status ?? 'upcoming',
        comp.type,
        comp.visibility ?? 'public',
      )
  }

  /** Grava ou atualiza o jogo, como o upsert do sync. */
  function upsertMatch(competitionId: string, match: Match) {
    sqlite
      .prepare(
        `INSERT INTO matches (
           id, competition_id, external_id, provider, home_team_id, away_team_id,
           start_time, status, round, phase, leg, postponed
         ) VALUES (?, ?, ?, 'espn', 'fla', 'pal', ?, ?, '1', ?, ?, 0)
         ON CONFLICT (id) DO UPDATE SET status = excluded.status, start_time = excluded.start_time`,
      )
      .run(
        match.id,
        competitionId,
        match.id,
        iso(match.start),
        match.status,
        match.phase ?? 'REGULAR_SEASON',
        match.leg ?? null,
      )
  }

  function column(competitionId: string) {
    return sqlite
      .prepare('SELECT status, visibility FROM competitions WHERE id = ?')
      .get(competitionId) as { status: string; visibility: string }
  }

  /** O status que a lista de grupos e o detalhe mostram. */
  function shown(competitionId: string): string {
    const row = sqlite
      .prepare(
        `SELECT ${competitionStatusSql('c', 'c', 'c.id')} AS status FROM competitions c WHERE c.id = ?`,
      )
      .get(competitionId) as { status: string }
    return row.status
  }

  return { db, addCompetition, upsertMatch, column, shown }
}

/** Competições que a descoberta sincronizou na execução. */
async function discover(db: D1Database, at: number): Promise<string[]> {
  syncMock.mockClear()
  await discoverFixtures(db, 'key', undefined, at)
  return syncMock.mock.calls.map(([opts]) => opts.competitionCode.replace(/^ext-/, ''))
}

describe('ciclo de vida da competição na descoberta', () => {
  beforeEach(() => {
    syncMock.mockReset()
    syncMock.mockResolvedValue(undefined as never)
  })

  it('copa passa de upcoming a ongoing e a finished, e sai da descoberta depois da confirmação', async () => {
    const { db, addCompetition, upsertMatch, column, shown } = openDb()
    addCompetition({ id: 'copa', provider: 'football-data', type: 'cup', visibility: 'pilot' })
    const finalStart = NOW - 2 * DAY
    upsertMatch('copa', { id: 'semi', start: NOW - 30 * DAY, status: 'scheduled', phase: 'SEMI_FINALS' })

    expect(await discover(db, NOW - 31 * DAY)).toEqual(['copa'])
    expect(column('copa').status).toBe('upcoming')

    upsertMatch('copa', { id: 'semi', start: NOW - 30 * DAY, status: 'finished', phase: 'SEMI_FINALS' })
    await discover(db, NOW - 29 * DAY)
    expect(column('copa').status).toBe('ongoing')
    expect(shown('copa')).toBe('ongoing')

    // Final encerrada: a tela já mostra o fim, mas a coluna espera a confirmação
    // e a descoberta continua buscando correções.
    upsertMatch('copa', { id: 'final', start: finalStart, status: 'finished', phase: 'FINAL' })
    expect(await discover(db, NOW)).toEqual(['copa'])
    expect(shown('copa')).toBe('finished')
    expect(column('copa').status).toBe('ongoing')

    const confirmed = finalStart + FINISH_CONFIRMATION_DAYS * DAY + 1
    expect(await discover(db, confirmed)).toEqual(['copa'])
    expect(column('copa')).toEqual({ status: 'finished', visibility: 'pilot' })

    expect(await discover(db, confirmed + DAY)).toEqual([])
  })

  it('final de ida e volta com só a ida gravada não encerra a copa', async () => {
    const { db, addCompetition, upsertMatch, column, shown } = openDb()
    addCompetition({ id: 'copa', provider: 'espn', type: 'cup', status: 'ongoing' })
    const firstLeg = NOW - 10 * DAY
    upsertMatch('copa', { id: 'ida', start: firstLeg, status: 'finished', phase: 'FINAL', leg: 1 })

    expect(shown('copa')).toBe('ongoing')
    expect(await discover(db, NOW)).toEqual(['copa'])
    expect(column('copa').status).toBe('ongoing')

    // A volta entra no horizonte da descoberta, é disputada e confirma o fim.
    const secondLeg = NOW - 3 * DAY
    upsertMatch('copa', { id: 'volta', start: secondLeg, status: 'finished', phase: 'FINAL', leg: 2 })
    expect(shown('copa')).toBe('finished')
    await discover(db, secondLeg + FINISH_CONFIRMATION_DAYS * DAY + 1)
    expect(column('copa').status).toBe('finished')
  })

  it('liga da ESPN numa pausa do calendário continua em andamento', async () => {
    const { db, addCompetition, upsertMatch, column, shown } = openDb()
    addCompetition({ id: 'serie-b', provider: 'espn', type: 'league', status: 'ongoing' })
    // A descoberta da ESPN só enxerga 7 dias adiante: na data FIFA nenhum jogo
    // gravado está pendente.
    upsertMatch('serie-b', { id: 'r1', start: NOW - 20 * DAY, status: 'finished' })
    upsertMatch('serie-b', { id: 'r2', start: NOW - 12 * DAY, status: 'finished' })

    expect(shown('serie-b')).toBe('ongoing')
    expect(await discover(db, NOW)).toEqual(['serie-b'])
    expect(column('serie-b').status).toBe('ongoing')
    expect(await discover(db, NOW + DAY)).toEqual(['serie-b'])
  })

  it('liga da ESPN sem jogo novo há mais de 60 dias encerra', async () => {
    const { db, addCompetition, upsertMatch, column, shown } = openDb()
    addCompetition({ id: 'serie-b', provider: 'espn', type: 'league', status: 'ongoing' })
    upsertMatch('serie-b', { id: 'r38', start: NOW - 61 * DAY, status: 'finished' })

    expect(shown('serie-b')).toBe('finished')
    await discover(db, NOW)
    expect(column('serie-b').status).toBe('finished')
    expect(await discover(db, NOW + DAY)).toEqual([])
  })

  it('liga da football-data encerra quando o calendário completo acaba', async () => {
    const { db, addCompetition, upsertMatch, column, shown } = openDb()
    addCompetition({ id: 'liga', provider: 'football-data', type: 'league', status: 'ongoing' })
    upsertMatch('liga', { id: 'r37', start: NOW - 9 * DAY, status: 'finished' })
    upsertMatch('liga', { id: 'r38', start: NOW - 8 * DAY, status: 'finished' })

    expect(shown('liga')).toBe('finished')
    await discover(db, NOW)
    expect(column('liga').status).toBe('finished')
  })

  it('jogo pendente impede o fim, mesmo com a final gravada', async () => {
    const { db, addCompetition, upsertMatch, column } = openDb()
    addCompetition({ id: 'copa', provider: 'football-data', type: 'cup', status: 'ongoing' })
    upsertMatch('copa', { id: 'final', start: NOW - 20 * DAY, status: 'finished', phase: 'FINAL' })
    upsertMatch('copa', { id: 'remarcado', start: NOW - 25 * DAY, status: 'scheduled', phase: 'SEMI_FINALS' })

    await discover(db, NOW)
    expect(column('copa').status).toBe('ongoing')
  })

  it('competição sincronizada com falha não avança o status', async () => {
    const { db, addCompetition, upsertMatch, column } = openDb()
    addCompetition({ id: 'liga', provider: 'football-data', type: 'league', status: 'ongoing' })
    upsertMatch('liga', { id: 'r38', start: NOW - 30 * DAY, status: 'finished' })
    syncMock.mockRejectedValueOnce(new Error('HTTP 503'))

    await discover(db, NOW)
    expect(column('liga').status).toBe('ongoing')
  })
})

describe('reconcileCompetitionStatus', () => {
  it('correção tardia não reabre a competição encerrada', async () => {
    const { db, addCompetition, upsertMatch, column, shown } = openDb()
    addCompetition({ id: 'copa', provider: 'football-data', type: 'cup', status: 'finished' })
    upsertMatch('copa', { id: 'final', start: NOW - 20 * DAY, status: 'finished', phase: 'FINAL' })
    // Jogo que o sync manual do admin trouxe depois do encerramento.
    upsertMatch('copa', { id: 'extra', start: NOW + 5 * DAY, status: 'scheduled', phase: 'FINAL' })

    expect(await reconcileCompetitionStatus(db, 'copa', NOW)).toBeNull()
    expect(column('copa').status).toBe('finished')
    expect(shown('copa')).toBe('finished')
  })

  it('competição sem jogos continua upcoming', async () => {
    const { db, addCompetition, column } = openDb()
    addCompetition({ id: 'copa', provider: 'espn', type: 'cup' })

    expect(await reconcileCompetitionStatus(db, 'copa', NOW)).toBe('upcoming')
    expect(column('copa').status).toBe('upcoming')
  })

  it('não rebaixa ongoing para upcoming', async () => {
    const { db, addCompetition, upsertMatch, column } = openDb()
    addCompetition({ id: 'liga', provider: 'football-data', type: 'league', status: 'ongoing' })
    upsertMatch('liga', { id: 'r1', start: NOW + DAY, status: 'scheduled' })

    expect(await reconcileCompetitionStatus(db, 'liga', NOW)).toBe('ongoing')
    expect(column('liga').status).toBe('ongoing')
  })

  it('reconciliar duas vezes dá o mesmo resultado', async () => {
    const { db, addCompetition, upsertMatch, column } = openDb()
    addCompetition({ id: 'copa', provider: 'football-data', type: 'cup' })
    upsertMatch('copa', { id: 'final', start: NOW - 100 * DAY, status: 'finished', phase: 'FINAL' })

    expect(await reconcileCompetitionStatus(db, 'copa', NOW)).toBe('finished')
    expect(await reconcileCompetitionStatus(db, 'copa', NOW)).toBeNull()
    expect(column('copa').status).toBe('finished')
  })
})
