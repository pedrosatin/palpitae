import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./apiFootball', () => ({
  fetchCurrentLeagues: vi.fn(),
  fetchMatchCountByLeague: vi.fn(),
}))
vi.mock('./wikipedia', () => ({ fetchPageviews: vi.fn() }))

import { fetchCurrentLeagues, fetchMatchCountByLeague, type ProviderLeague } from './apiFootball'
import { syncRadar } from './sync'
import { fetchPageviews } from './wikipedia'

const leaguesMock = vi.mocked(fetchCurrentLeagues)
const countsMock = vi.mocked(fetchMatchCountByLeague)
const pageviewsMock = vi.mocked(fetchPageviews)

const NOW = new Date('2026-08-18T07:00:00Z')

function league(over: Partial<ProviderLeague> = {}): ProviderLeague {
  return {
    externalId: '13',
    name: 'CONMEBOL Libertadores',
    country: 'World',
    type: 'Cup',
    logoUrl: 'https://logo.png',
    season: '2026',
    startsOn: '2026-02-04',
    endsOn: '2026-11-28',
    ...over,
  }
}

/** D1 falso: guarda o SQL e os binds de cada statement passado ao batch. */
function buildFakeDb() {
  const statements: { sql: string; params: unknown[] }[] = []
  const db = {
    prepare(sql: string) {
      const record = { sql, params: [] as unknown[] }
      const stmt = {
        bind(...args: unknown[]) {
          record.params = args
          return stmt
        },
        _record: record,
      }
      // Registrado na preparação: o batch recebe o statement já vinculado.
      statements.push(record)
      return stmt
    },
    batch: vi.fn(async () => []),
  }
  return { db, statements }
}

function buildFakeAe() {
  return { writeDataPoint: vi.fn() }
}

type WrittenPoint = { blobs?: string[]; doubles?: number[] }

function pointsOfType(ae: { writeDataPoint: ReturnType<typeof vi.fn> }, type: string) {
  return ae.writeDataPoint.mock.calls
    .map((c) => c[0] as WrittenPoint)
    .filter((p) => p.blobs?.[0] === type)
}

describe('syncRadar', () => {
  beforeEach(() => {
    leaguesMock.mockReset()
    countsMock.mockReset()
    pageviewsMock.mockReset()
    pageviewsMock.mockResolvedValue(new Map())
    countsMock.mockResolvedValue(new Map())
  })

  it('não chama nenhuma API sem chave configurada', async () => {
    const { db } = buildFakeDb()
    const ae = buildFakeAe()

    await syncRadar(db as never, '', ae as never, NOW)

    expect(leaguesMock).not.toHaveBeenCalled()
    expect(pointsOfType(ae, 'radar_sync_run')[0]?.blobs?.[1]).toBe('misconfig')
  })

  it('grava a competição e o número de jogos do dia', async () => {
    const { db, statements } = buildFakeDb()
    leaguesMock.mockResolvedValue([league()])
    countsMock.mockResolvedValue(new Map([['13', 4]]))

    await syncRadar(db as never, 'key', undefined, NOW)

    const insert = statements.find((s) => s.sql.includes('INSERT INTO competition_radar\n'))
    expect(insert?.params).toContain('CONMEBOL Libertadores')
    // Artigo curado resolvido a partir de (país, nome).
    expect(insert?.params).toContain('Copa Libertadores da América')

    const daily = statements.find((s) => s.sql.includes('matches_today'))
    expect(daily?.params).toEqual(['api-football:13:2026', '2026-08-18', 4])
  })

  it('descarta ligas fora do recorte de países e sem curadoria', async () => {
    const { db, statements } = buildFakeDb()
    leaguesMock.mockResolvedValue([
      league({ externalId: '999', name: 'Meistriliiga', country: 'Estonia' }),
    ])

    await syncRadar(db as never, 'key', undefined, NOW)

    expect(statements.some((s) => s.sql.includes('INSERT INTO competition_radar\n'))).toBe(false)
  })

  it('guarda liga de país relevante mesmo sem artigo mapeado', async () => {
    const { db, statements } = buildFakeDb()
    leaguesMock.mockResolvedValue([
      league({ externalId: '77', name: 'Copa Do Brasil Sub 20', country: 'Brazil' }),
    ])

    await syncRadar(db as never, 'key', undefined, NOW)

    const insert = statements.find((s) => s.sql.includes('INSERT INTO competition_radar\n'))
    expect(insert?.params.at(-1)).toBeNull() // wiki_article
    expect(pageviewsMock).not.toHaveBeenCalled()
  })

  it('coleta pageviews da janela e grava uma linha por dia', async () => {
    const { db, statements } = buildFakeDb()
    leaguesMock.mockResolvedValue([league()])
    pageviewsMock.mockResolvedValue(
      new Map([
        ['2026-08-16', 900],
        ['2026-08-17', 1100],
      ]),
    )

    await syncRadar(db as never, 'key', undefined, NOW)

    expect(pageviewsMock).toHaveBeenCalledWith(
      'Copa Libertadores da América',
      '2026-08-10',
      '2026-08-18',
    )
    const pageviewRows = statements.filter((s) => s.sql.includes('pageviews'))
    expect(pageviewRows.map((s) => s.params)).toEqual([
      ['api-football:13:2026', '2026-08-16', 900],
      ['api-football:13:2026', '2026-08-17', 1100],
    ])
  })

  it('não deixa artigo quebrado derrubar o snapshot', async () => {
    const { db } = buildFakeDb()
    const ae = buildFakeAe()
    leaguesMock.mockResolvedValue([league()])
    pageviewsMock.mockRejectedValue(new Error('boom'))

    await syncRadar(db as never, 'key', ae as never, NOW)

    // Competições foram gravadas mesmo assim; run marcado como parcial.
    expect(db.batch).toHaveBeenCalled()
    expect(pointsOfType(ae, 'radar_sync_run')[0]?.blobs?.[1]).toBe('partial')
  })

  it('aborta sem escrever quando a API-Football falha', async () => {
    const { db } = buildFakeDb()
    const ae = buildFakeAe()
    leaguesMock.mockRejectedValue(new Error('quota estourada'))

    await syncRadar(db as never, 'key', ae as never, NOW)

    expect(db.batch).not.toHaveBeenCalled()
    expect(countsMock).not.toHaveBeenCalled() // não gasta a 2ª chamada da quota
    expect(pointsOfType(ae, 'radar_sync_run')[0]?.blobs?.[1]).toBe('error')
  })
})
