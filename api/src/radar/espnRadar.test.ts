import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../providers/espn', () => ({ fetchEspnScoreboard: vi.fn() }))

import { fetchEspnScoreboard, type EspnScoreboard } from '../providers/espn'
import bra1ScoreboardJson from './__fixtures__/espn-bra1-scoreboard.json'
import espnCatalogJson from './__fixtures__/espn-catalog.json'
import { findEntry, RADAR_COUNTRIES } from './articles'
import { ESPN_LEAGUES, fetchEspnLeaguesAndCounts, type ProviderLeague } from './espnRadar'

const scoreboardMock = vi.mocked(fetchEspnScoreboard)

/** Payload real de bra.1 em 2026-10-07: 5 jogos no dia 07 (UTC) e 1 no dia 08. */
const BRA1_FIXTURE = bra1ScoreboardJson as unknown as EspnScoreboard

/** Catálogo completo de slugs da ESPN (219) — espelho para o teste de recorte. */
const ESPN_CATALOG = espnCatalogJson as string[]

/** Scoreboard sintético no formato mínimo que o radar lê. */
function board(over: {
  events?: { date: string }[]
  season?: { year: number; startDate: string; endDate: string }
}): EspnScoreboard {
  return {
    events: over.events ?? [],
    leagues: [
      {
        name: 'Nome ESPN (ignorado — vale o da curadoria)',
        logos: [{ href: 'https://a.espncdn.com/i/leaguelogos/soccer/500/85.png' }],
        season: over.season ?? { year: 2026, startDate: '2026-01-01T05:05Z', endDate: '2026-12-31T04:59Z' },
      },
    ],
  }
}

describe('fetchEspnLeaguesAndCounts', () => {
  beforeEach(() => {
    scoreboardMock.mockReset()
  })

  it('parseia o scoreboard real: liga corrente, jogos contados pela data do evento', async () => {
    scoreboardMock.mockImplementation(async (slug) =>
      slug === 'bra.1' ? BRA1_FIXTURE : board({ events: [] }),
    )

    const { leagues, counts } = await fetchEspnLeaguesAndCounts('2026-10-07')

    // Nome/país vêm da curadoria, não da ESPN ("Brazilian Serie A").
    const bra1 = leagues.find((l) => l.externalId === 'bra.1')
    expect(bra1).toMatchObject({
      externalId: 'bra.1',
      name: 'Serie A',
      country: 'Brazil',
      type: 'League',
      season: '2026',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/85.png',
    })
    // 5 dos 6 eventos são de 2026-10-07 (UTC); o 6º é 00:30Z do dia 08.
    expect(counts.get('bra.1')).toBe(5)
    // Liga sem jogos na data segue no snapshot com zero.
    expect(counts.get('bra.2')).toBe(0)
    expect(scoreboardMock).toHaveBeenCalledWith('bra.1', '20261007')
  })

  it('data sem jogos conta zero mesmo com a rodada vizinha na resposta', async () => {
    // A ESPN devolve a rodada seguinte para datas sem jogo — o filtro por
    // `event.date` é o que separa "jogos do dia" de "jogos por perto".
    scoreboardMock.mockImplementation(async (slug) =>
      slug === 'bra.1' ? BRA1_FIXTURE : board({ events: [] }),
    )

    const { counts } = await fetchEspnLeaguesAndCounts('2026-10-04')

    expect(counts.get('bra.1')).toBe(0)
  })

  it('pula liga sem season (fora de catálogo/temporada)', async () => {
    scoreboardMock.mockImplementation(async (slug) =>
      slug === 'bra.1'
        ? { events: [], leagues: [{ name: 'Brazilian Serie A' }] }
        : board({ events: [] }),
    )

    const { leagues } = await fetchEspnLeaguesAndCounts('2026-10-07')

    expect(leagues.find((l) => l.externalId === 'bra.1')).toBeUndefined()
    expect(leagues.length).toBe(ESPN_LEAGUES.length - 1)
  })

  it('pula temporada encerrada: a ESPN deixa a última season no scoreboard', async () => {
    scoreboardMock.mockImplementation(async (slug) =>
      slug === 'uefa.euro'
        ? // Euro 2024 em 2026: season vencida (caso real, conferido ao vivo).
          board({
            events: [{ date: '2024-07-14T20:00Z' }],
            season: { year: 2024, startDate: '2024-06-01T04:00Z', endDate: '2024-07-31T03:59Z' },
          })
        : board({ events: [] }),
    )

    const { leagues, counts } = await fetchEspnLeaguesAndCounts('2026-10-05')

    expect(leagues.find((l) => l.externalId === 'uefa.euro')).toBeUndefined()
    expect(counts.has('uefa.euro')).toBe(false)
  })

  it('pula temporada que ainda não começou', async () => {
    scoreboardMock.mockImplementation(async (slug) =>
      slug === 'conmebol.america'
        ? board({
            season: { year: 2028, startDate: '2028-06-01T04:00Z', endDate: '2028-07-31T03:59Z' },
          })
        : board({ events: [] }),
    )

    const { leagues } = await fetchEspnLeaguesAndCounts('2026-10-05')

    expect(leagues.find((l) => l.externalId === 'conmebol.america')).toBeUndefined()
  })

  it('falha parcial segue com os que responderam e registra os falhos', async () => {
    scoreboardMock.mockImplementation(async (slug) => {
      if (slug === 'bra.1') throw new Error('ESPN respondeu 503 em bra.1: boom')
      return board({ events: [] })
    })

    const { leagues, failed } = await fetchEspnLeaguesAndCounts('2026-10-07')

    expect(failed).toEqual(['bra.1'])
    expect(leagues.find((l) => l.externalId === 'bra.1')).toBeUndefined()
    expect(leagues.length).toBe(ESPN_LEAGUES.length - 1)
  })

  it('todos os slugs em erro → throw (fail-closed)', async () => {
    scoreboardMock.mockRejectedValue(new Error('DNS de sumiço'))

    await expect(fetchEspnLeaguesAndCounts('2026-10-07')).rejects.toThrow(
      'ESPN falhou em todos os 38 slugs do recorte',
    )
  })
})

describe('ESPN_LEAGUES (lista curada)', () => {
  it('não repete slug', () => {
    const slugs = ESPN_LEAGUES.map((l) => l.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('todos os slugs existem no catálogo da ESPN', () => {
    const missing = ESPN_LEAGUES.filter((l) => !ESPN_CATALOG.includes(l.slug))
    expect(missing.map((l) => l.slug)).toEqual([])
  })

  it('toda entrada é relevante: país do recorte ou mapeada na curadoria', () => {
    for (const ref of ESPN_LEAGUES) {
      const relevant =
        RADAR_COUNTRIES.has(ref.country) || findEntry(ref.country, ref.name) !== undefined
      expect(relevant, `slug ${ref.slug} fora do recorte`).toBe(true)
    }
  })

  it('nomes escolhidos casam com a curadoria de artigos (amostra)', () => {
    const bySlug = new Map(ESPN_LEAGUES.map((l) => [l.slug, l]))
    expect(findEntry('Brazil', bySlug.get('bra.1')!.name)?.article).toBe(
      'Campeonato Brasileiro de Futebol',
    )
    // ESPN chama de "Spanish La Liga" — aqui o nome casa com RADAR_ENTRIES.
    expect(findEntry('Spain', bySlug.get('esp.1')!.name)?.article).toBe('La Liga')
    expect(findEntry('World', bySlug.get('fifa.worldq.conmebol')!.name)?.article).toContain(
      'Eliminatórias',
    )
    expect(findEntry('World', bySlug.get('fifa.cwc')!.name)?.article).toBe(
      'Copa do Mundo de Clubes da FIFA',
    )
    // País tem que bater exatamente com o Set (sem normalização).
    expect(RADAR_COUNTRIES.has(bySlug.get('ksa.1')!.country)).toBe(true)
  })
})
