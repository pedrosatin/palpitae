/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { runProviderDrains } from './drainCoordinator'
import { footballDataDrain } from './fdWork'
import { clearFootballDataPause } from './footballDataQuota'
import { claimProviderWork, deferProviderWork, enqueueProviderWork } from './providerWork'
import { setFootballDataRateLimitForTests } from './providerBudget'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

/**
 * Ponta a ponta da coordenação da football-data (ADR-027), com o sync real
 * sobre o SQLite das migrations e o provedor simulado: orçamento compartilhado
 * entre execuções, 429 com reset e sem, fila durável, reinício do dreno,
 * recuperação além das 24 h do resgate e reprocesso idempotente.
 */

const drainFootballDataWork = (
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
): Promise<number> => runProviderDrains(db, [footballDataDrain({ apiKey, ae })], { ae })

const KICKOFF = '2026-11-08T15:30:00Z'
const NOW = Date.parse(KICKOFF) + 120 * 60_000
const MATCHDAYS = [10, 11]

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  clearFootballDataPause()
  // O setup global da suíte sobe o teto para os fluxos de pipeline.
  setFootballDataRateLimitForTests(1000)
})

function fdMatches(status: string, score: number | null) {
  return Response.json({
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: MATCHDAYS.map((matchday) => ({
      id: 567_000 + matchday,
      utcDate: KICKOFF,
      status,
      matchday,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: {
        id: matchday * 2,
        name: `Casa ${matchday}`,
        shortName: `C${matchday}`,
        tla: 'CAS',
      },
      awayTeam: {
        id: matchday * 2 + 1,
        name: `Fora ${matchday}`,
        shortName: `F${matchday}`,
        tla: 'FOR',
      },
      score: { duration: 'REGULAR', fullTime: { home: score, away: score } },
    })),
  })
}

function quotaExhausted(resetSeconds: number | null) {
  return Response.json(
    { message: 'You reached your request limit.', errorCode: 429 },
    {
      status: 429,
      headers: resetSeconds === null ? {} : { 'X-RequestCounter-Reset': String(resetSeconds) },
    },
  )
}

function fakeAe() {
  const writeDataPoint = vi.fn()
  const events = () =>
    writeDataPoint.mock.calls.map(([point]) => point as { blobs: string[]; doubles: number[] })
  return {
    ae: { writeDataPoint } as unknown as AnalyticsEngineDataset,
    events,
  }
}

const SEM_VAGA = 'football-data.org: sem vaga no orçamento compartilhado de chamadas'

async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const provider = { respond: () => fdMatches('TIMED', null) }
  const fdCalls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      fdCalls.push(url.searchParams.get('matchday') ?? '')
      return provider.respond()
    }),
  )
  await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' })
  fdCalls.length = 0
  return { sqlite, db, provider, fdCalls }
}

function workRows(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT kind, competition_code, round, status, attempts, not_before, last_error
        FROM provider_work ORDER BY kind, competition_code, round`,
    )
    .all() as Record<string, string | number | null>[]
}

describe('coordenação das chamadas da football-data', () => {
  it('orçamento do minuto compartilhado: o que não cabe fica pendente e o dreno retoma', async () => {
    setFootballDataRateLimitForTests(1)
    const { sqlite, db, provider, fdCalls } = await setup()
    const { ae } = fakeAe()

    await pollActiveMatches(db, 'test', ae, NOW)

    expect(fdCalls).toHaveLength(1)
    expect(workRows(sqlite)).toHaveLength(1)
    expect(workRows(sqlite)[0]).toMatchObject({
      kind: 'result',
      status: 'pending',
      attempts: 0,
      last_error: SEM_VAGA,
    })

    provider.respond = () => fdMatches('FINISHED', 1)
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
    await drainFootballDataWork(db, 'test', ae)

    expect(fdCalls).toHaveLength(2)
    expect(workRows(sqlite)[0]).toMatchObject({ status: 'done', attempts: 0 })
  })

  it('429 com reset válido: nada repete na hora, o bloqueio vale para o dreno e a retomada pontua', async () => {
    const { sqlite, db, provider, fdCalls } = await setup()
    const { ae } = fakeAe()
    // Reset acima da espera máxima: o retry dentro da chamada falha sem request.
    provider.respond = () => quotaExhausted(90)

    await pollActiveMatches(db, 'test', ae, NOW)

    // As tentativas em voo tomaram 429; nenhuma repetiu na hora e o trabalho
    // ficou pendente, com retomada no reset.
    expect(fdCalls).toHaveLength(2)
    const rows = workRows(sqlite)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'pending', attempts: 0 })
      expect(String(row.last_error)).toContain('cota esgotada')
      expect(Number(row.not_before)).toBeGreaterThan(Date.now() + 30_000)
    }
    const state = sqlite.prepare('SELECT blocked_until FROM provider_rate_state').get() as {
      blocked_until: number
    }
    expect(state.blocked_until).toBeGreaterThan(Date.now() + 30_000)

    provider.respond = () => fdMatches('FINISHED', 1)
    vi.useFakeTimers({ now: Date.now() + 91_000, toFake: ['Date'] })
    await drainFootballDataWork(db, 'test', ae)
    expect(workRows(sqlite).every((row) => row.status === 'done')).toBe(true)
    expect(fdCalls).toHaveLength(4)

    await pollActiveMatches(db, 'test', ae, NOW + 61_000)
    const scored = sqlite
      .prepare('SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NOT NULL')
      .get() as { n: number }
    expect(scored.n).toBe(2)
  })

  it('429 sem reset: retomada conservadora depois de uma janela, com tentativas contadas', async () => {
    const { sqlite, db, provider, fdCalls } = await setup()
    const { ae } = fakeAe()
    provider.respond = () => quotaExhausted(null)
    const start = Date.now()

    // O retry do 429 espera a janela conservadora (falsificada). A pausa local
    // é compartilhada pelas duas tarefas: o retry da segunda espera a janela
    // que o 429 do primeiro abriu, então são duas esperas.
    vi.useFakeTimers({ now: start, toFake: ['Date', 'setTimeout'] })
    const done = pollActiveMatches(db, 'test', ae, NOW)
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(61_000)
    await done

    expect(fdCalls).toHaveLength(4)
    const state = sqlite.prepare('SELECT blocked_until FROM provider_rate_state').get() as {
      blocked_until: number
    }
    expect(state.blocked_until).toBeGreaterThan(start)
    const rows = workRows(sqlite)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      // A falha repetida vira pendência com o prazo conservador do adiamento.
      expect(row).toMatchObject({ status: 'pending', attempts: 0 })
      expect(Number(row.not_before)).toBeGreaterThan(start)
    }
  })

  it('reinício do dreno: lease vencido é retomado sem duplicar jogo', async () => {
    setFootballDataRateLimitForTests(1)
    const { sqlite, db, provider, fdCalls } = await setup()
    const { ae } = fakeAe()

    await pollActiveMatches(db, 'test', ae, NOW)
    expect(workRows(sqlite)[0].status).toBe('pending')

    // Um dreno reclamou o item e o isolate morreu antes de executar.
    await claimProviderWork(db, { provider: 'football-data', now: Date.now() })

    provider.respond = () => fdMatches('FINISHED', 1)
    vi.useFakeTimers({ now: Date.now() + 7 * 60_000, toFake: ['Date'] })
    await drainFootballDataWork(db, 'test', ae)

    expect(fdCalls).toHaveLength(2)
    expect(workRows(sqlite)[0]).toMatchObject({ status: 'done' })
    const matches = sqlite.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }
    expect(matches.n).toBe(2)
  })

  it('recupera pendência muito depois da janela de 24 horas do resgate', async () => {
    const { sqlite, db, provider, fdCalls } = await setup()
    const { ae } = fakeAe()
    provider.respond = () => fdMatches('TIMED', null)

    // Uma vaga negada há 25 horas ficou pendente; nada a apaga por idade e a
    // retomada pega o jogo que a janela de resgate já deixou de consultar.
    await deferProviderWork(
      db,
      {
        kind: 'result',
        competitionCode: 'PPL',
        season: '2026',
        round: '10',
        competitionId: 'c1',
      },
      new Error(SEM_VAGA),
      Date.now() - 25 * 60 * 60_000,
    )

    provider.respond = () => fdMatches('FINISHED', 1)
    await drainFootballDataWork(db, 'test', ae)

    expect(fdCalls).toHaveLength(1)
    expect(workRows(sqlite)[0]).toMatchObject({ status: 'done' })
  })

  it('prioriza resultado sobre descoberta quando o orçamento só cabe um', async () => {
    const { sqlite, db } = await setup()

    await deferProviderWork(
      db,
      { kind: 'discovery', competitionCode: 'WC', season: '2026', round: '', competitionId: 'c9' },
      new Error(SEM_VAGA),
    )
    await deferProviderWork(
      db,
      { kind: 'result', competitionCode: 'PPL', season: '2026', round: '10', competitionId: 'c1' },
      new Error(SEM_VAGA),
    )
    sqlite.exec('UPDATE provider_work SET not_before = 0')

    const claimed = await claimProviderWork(db, {
      provider: 'football-data',
      limit: 1,
      now: Date.now(),
    })
    expect(claimed).toEqual([
      {
        kind: 'result',
        competitionCode: 'PPL',
        season: '2026',
        round: '10',
        competitionId: 'c1',
        attempts: 0,
        leaseOwner: expect.any(String),
      },
    ])
  })

  it('reprocesso idempotente: reexecutar o item não duplica nem regride dado confirmado', async () => {
    const { sqlite, db, provider, fdCalls } = await setup()
    const { ae } = fakeAe()
    provider.respond = () => fdMatches('FINISHED', 2)

    await pollActiveMatches(db, 'test', ae, NOW)
    expect(fdCalls).toHaveLength(2)
    const scored = sqlite
      .prepare('SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NOT NULL')
      .get() as { n: number }
    expect(scored.n).toBe(2)
    const before = sqlite.prepare('SELECT * FROM matches ORDER BY external_id').all()
    const predictions = sqlite.prepare('SELECT COUNT(*) AS n FROM predictions').get()

    // O produtor replaneia o mesmo trabalho (correção do provedor, por exemplo);
    // o dreno reexecuta os itens concluídos.
    await enqueueProviderWork(db, [
      { kind: 'result', competitionCode: 'PPL', season: '2026', round: '10', competitionId: 'c1' },
      { kind: 'result', competitionCode: 'PPL', season: '2026', round: '11', competitionId: 'c1' },
    ])
    await drainFootballDataWork(db, 'test', ae)

    expect(fdCalls).toHaveLength(4)
    expect(sqlite.prepare('SELECT * FROM matches ORDER BY external_id').all()).toEqual(before)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM predictions').get()).toEqual(predictions)
    const stillScored = sqlite
      .prepare('SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NOT NULL')
      .get() as { n: number }
    expect(stillScored.n).toBe(2)
  })

  it('o dreno registra a execução em provider_work_run', async () => {
    const { db, provider } = await setup()
    const { ae, events } = fakeAe()
    provider.respond = () => fdMatches('TIMED', null)
    await deferProviderWork(
      db,
      { kind: 'result', competitionCode: 'PPL', season: '2026', round: '10', competitionId: 'c1' },
      new Error(SEM_VAGA),
    )
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })

    await drainFootballDataWork(db, 'test', ae)

    const runs = events().filter((point) => point.blobs?.[0] === 'provider_work_run')
    expect(runs).toHaveLength(1)
    expect(runs[0].blobs?.[1]).toBe('ok')
    expect(runs[0].doubles?.slice(0, 4)).toEqual([1, 1, 0, 0])
  })

  it('falha do pós-sync no dreno vira erro da execução e log, sem repetir o item', async () => {
    const { sqlite, db, provider } = await setup()
    const { ae, events } = fakeAe()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    provider.respond = () => fdMatches('FINISHED', 1)
    // O repontuar do pós-sync do item manual falha ao gravar a pontuação.
    sqlite.exec(`CREATE TRIGGER fail_scoring BEFORE UPDATE OF scored_at ON matches
      WHEN NEW.scored_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'scoring boom'); END`)
    await deferProviderWork(
      db,
      { kind: 'manual', competitionCode: 'PPL', season: '2026', round: '10', competitionId: 'c1' },
      new Error(SEM_VAGA),
    )
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })

    await drainFootballDataWork(db, 'test', ae)

    const runs = events().filter((point) => point.blobs?.[0] === 'provider_work_run')
    expect(runs[0].blobs?.[1]).toBe('error')
    expect(
      events().some((point) => point.blobs?.[0] === 'football_api_error'),
    ).toBe(true)
    expect(workRows(sqlite).find((row) => row.kind === 'manual')?.status).toBe('done')
    errorSpy.mockRestore()
  })
})
