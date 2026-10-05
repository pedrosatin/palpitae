import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./espnRadar', () => ({ fetchEspnLeaguesAndCounts: vi.fn() }))
vi.mock('./wikipedia', () => ({ fetchPageviews: vi.fn() }))

import { fetchEspnLeaguesAndCounts, type ProviderLeague } from './espnRadar'
import { syncRadar } from './sync'
import { fetchPageviews } from './wikipedia'

const snapshotMock = vi.mocked(fetchEspnLeaguesAndCounts)
const pageviewsMock = vi.mocked(fetchPageviews)

const NOW = new Date('2026-08-18T07:00:00Z')

function league(over: Partial<ProviderLeague> = {}): ProviderLeague {
  return {
    externalId: 'conmebol.libertadores',
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

/** Resposta do fetchEspnLeaguesAndCounts já no formato do snapshot. */
function snapshot(leagues: ProviderLeague[], counts = new Map<string, number>(), failed: string[] = []) {
  return { leagues, counts, failed }
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
    snapshotMock.mockReset()
    pageviewsMock.mockReset()
    pageviewsMock.mockResolvedValue(new Map())
  })

  it('grava a competição, os jogos do dia e o purge do provedor antigo', async () => {
    const { db, statements } = buildFakeDb()
    snapshotMock.mockResolvedValue(
      snapshot([league()], new Map([['conmebol.libertadores', 4]])),
    )

    await syncRadar(db as never, undefined, NOW)

    // Migração de provedor: as linhas da API-Football saem todos os dias
    // (idempotente — depois da primeira execução não remove nada).
    const purgeDaily = statements.find((s) =>
      s.sql.includes('DELETE FROM competition_radar_daily'),
    )
    expect(purgeDaily?.params).toEqual(['api-football:%'])
    const purge = statements.find((s) =>
      s.sql.includes('DELETE FROM competition_radar WHERE provider'),
    )
    expect(purge?.params).toEqual(['api-football'])
    const reset = statements.find((s) => s.sql.includes('is_current = 0'))
    expect(reset?.params).toEqual(['espn'])

    const insert = statements.find((s) => s.sql.includes('INSERT INTO competition_radar\n'))
    expect(insert?.params).toContain('CONMEBOL Libertadores')
    // Artigo curado resolvido a partir de (país, nome).
    expect(insert?.params).toContain('Copa Libertadores da América')

    // Id novo com prefixo do provedor novo.
    const daily = statements.find((s) => s.sql.includes('matches_today'))
    expect(daily?.params).toEqual(['espn:conmebol.libertadores:2026', '2026-08-18', 4])
  })

  it('descarta ligas fora do recorte de países e sem curadoria', async () => {
    const { db, statements } = buildFakeDb()
    snapshotMock.mockResolvedValue(
      snapshot([league({ externalId: 'est.1', name: 'Meistriliiga', country: 'Estonia' })]),
    )

    await syncRadar(db as never, undefined, NOW)

    expect(statements.some((s) => s.sql.includes('INSERT INTO competition_radar\n'))).toBe(false)
  })

  it('guarda liga de país relevante mesmo sem artigo mapeado', async () => {
    const { db, statements } = buildFakeDb()
    snapshotMock.mockResolvedValue(
      snapshot([league({ externalId: 'bra.copa_do_brazil', name: 'Copa Do Brasil Sub 20', country: 'Brazil' })]),
    )

    await syncRadar(db as never, undefined, NOW)

    const insert = statements.find((s) => s.sql.includes('INSERT INTO competition_radar\n'))
    expect(insert?.params.at(-1)).toBeNull() // wiki_article
    expect(pageviewsMock).not.toHaveBeenCalled()
  })

  it('coleta pageviews da janela e grava uma linha por dia', async () => {
    const { db, statements } = buildFakeDb()
    snapshotMock.mockResolvedValue(snapshot([league()]))
    pageviewsMock.mockResolvedValue(
      new Map([
        ['2026-08-16', 900],
        ['2026-08-17', 1100],
      ]),
    )

    await syncRadar(db as never, undefined, NOW)

    expect(pageviewsMock).toHaveBeenCalledWith(
      'Copa Libertadores da América',
      '2026-08-10',
      '2026-08-18',
    )
    const pageviewRows = statements.filter((s) => s.sql.includes('pageviews'))
    expect(pageviewRows.map((s) => s.params)).toEqual([
      ['espn:conmebol.libertadores:2026', '2026-08-16', 900],
      ['espn:conmebol.libertadores:2026', '2026-08-17', 1100],
    ])
  })

  it('não deixa artigo quebrado derrubar o snapshot', async () => {
    const { db } = buildFakeDb()
    const ae = buildFakeAe()
    snapshotMock.mockResolvedValue(snapshot([league()]))
    pageviewsMock.mockRejectedValue(new Error('boom'))

    await syncRadar(db as never, ae as never, NOW)

    // Competições foram gravadas mesmo assim; run marcado como parcial.
    expect(db.batch).toHaveBeenCalled()
    expect(pointsOfType(ae, 'radar_sync_run')[0]?.blobs?.[1]).toBe('partial')
  })

  it('loga slug com falha parcial e segue com o resto do snapshot', async () => {
    const { db } = buildFakeDb()
    const ae = buildFakeAe()
    snapshotMock.mockResolvedValue(snapshot([league()], new Map(), ['bra.1', 'ven.1']))

    await syncRadar(db as never, ae as never, NOW)

    expect(db.batch).toHaveBeenCalled()
    const errors = pointsOfType(ae, 'radar_sync_error')
    expect(errors[0]?.blobs?.[1]).toBe('espn')
    expect(errors[0]?.blobs?.at(-1)).toContain('bra.1,ven.1')
    expect(pointsOfType(ae, 'radar_sync_run')[0]?.blobs?.[1]).toBe('ok')
  })

  it('aborta sem escrever quando a ESPN falha inteira', async () => {
    const { db } = buildFakeDb()
    const ae = buildFakeAe()
    snapshotMock.mockRejectedValue(new Error('ESPN falhou em todos os 38 slugs do recorte'))

    await syncRadar(db as never, ae as never, NOW)

    expect(db.batch).not.toHaveBeenCalled()
    expect(pointsOfType(ae, 'radar_sync_run')[0]?.blobs?.[1]).toBe('error')
  })

  it('aborta quando nenhuma liga vem corrente: snapshot vazio não substitui o bom', async () => {
    const { db } = buildFakeDb()
    const ae = buildFakeAe()
    snapshotMock.mockResolvedValue(snapshot([]))

    await syncRadar(db as never, ae as never, NOW)

    expect(db.batch).not.toHaveBeenCalled()
    expect(pointsOfType(ae, 'radar_sync_run')[0]?.blobs?.[1]).toBe('error')
  })
})
