/// <reference types="node" />
/**
 * Fronteira HTTP do parser de fases regionais (Ticket 08).
 *
 * Cada evento abaixo usa id, data, season.slug e times observados no
 * scoreboard ESPN 2026 (proxy de validação dos spikes Paulista, Carioca,
 * Mineiro, Gaúcho e Copa do Nordeste). Campos pesados omitidos; o sync só
 * precisa de id/date/season/competitors/status para importar.
 */
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import type { EspnScoreboardEvent } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { ESPN_PRIMARY_COMPETITIONS } from './espnSync'

const JWT_SECRET = 'test-regional-stages-secret'
const ADMIN_EMAIL = 'admin@palpitae.com'
const PILOT_EMAIL = 'piloto@palpitae.com'

/** Código de teste: o mapa de fases é global; não cadastra competição de produção. */
const TEST_CODE = 'test.bra.regional.stages'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  delete ESPN_PRIMARY_COMPETITIONS[TEST_CODE]
})

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL,
    PILOT_EMAILS: PILOT_EMAIL,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com',
    FRONTEND_URL: 'https://palpitae.com',
    FOOTBALL_API_KEY: '',
    RESEND_API_KEY: 'test-resend-key',
  }
}

const fakeExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext

type TeamRef = { id: string; displayName: string }

function minimalEvent(opts: {
  id: string
  date: string
  slug: string
  home: TeamRef
  away: TeamRef
  year?: number
}): EspnScoreboardEvent {
  return {
    id: opts.id,
    date: opts.date,
    season: { year: opts.year ?? 2026, slug: opts.slug },
    competitions: [
      {
        status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
        competitors: [
          {
            homeAway: 'home',
            team: {
              id: opts.home.id,
              displayName: opts.home.displayName,
              shortDisplayName: opts.home.displayName,
              abbreviation: opts.home.displayName.slice(0, 3),
            },
          },
          {
            homeAway: 'away',
            team: {
              id: opts.away.id,
              displayName: opts.away.displayName,
              shortDisplayName: opts.away.displayName,
              abbreviation: opts.away.displayName.slice(0, 3),
            },
          },
        ],
      },
    ],
  }
}

/**
 * Um evento real por fase nova comprovada nos spikes (scoreboard 2026).
 * Proveniência: campos id/date/season.slug/times do scoreboard ESPN público
 * das competições bra.camp.paulista, bra.camp.carioca, bra.camp.mineiro,
 * bra.camp.gaucho e bra.copa_do_nordeste.
 */
const NEW_PHASE_EVENTS: Array<{
  event: EspnScoreboardEvent
  phase: string
  roundLabel: string
}> = [
  // Paulista
  {
    event: minimalEvent({
      id: '762074',
      date: '2026-01-10T23:30Z',
      slug: 'league-phase',
      home: { id: '4773', displayName: 'Portuguesa' },
      away: { id: '2029', displayName: 'Palmeiras' },
    }),
    phase: 'LEAGUE_PHASE',
    roundLabel: 'Fase de pontos',
  },
  {
    event: minimalEvent({
      id: '401863163',
      date: '2026-03-04T23:00Z',
      slug: 'finals',
      home: { id: '2029', displayName: 'Palmeiras' },
      away: { id: '18127', displayName: 'Novorizontino' },
    }),
    phase: 'FINAL',
    roundLabel: 'Final',
  },
  // Carioca
  {
    event: minimalEvent({
      id: '751664',
      date: '2026-01-11T21:00Z',
      slug: 'taca-guanabara',
      home: { id: '819', displayName: 'Flamengo' },
      away: { id: '18134', displayName: 'Portuguesa-RJ' },
    }),
    phase: 'TACA_GUANABARA',
    roundLabel: 'Taça Guanabara',
  },
  {
    event: minimalEvent({
      id: '401860446',
      date: '2026-02-13T20:00Z',
      slug: 'taca-guanabara---quarterfinals',
      home: { id: '4786', displayName: 'Madureira' },
      away: { id: '900', displayName: 'Boavista' },
    }),
    phase: 'TACA_GUANABARA_QUARTER_FINALS',
    roundLabel: 'Quartas da Taça Guanabara',
  },
  {
    event: minimalEvent({
      id: '401861655',
      date: '2026-02-22T21:00Z',
      slug: 'taca-guanabara---semifinals',
      home: { id: '3454', displayName: 'Vasco da Gama' },
      away: { id: '3445', displayName: 'Fluminense' },
    }),
    phase: 'TACA_GUANABARA_SEMI_FINALS',
    roundLabel: 'Semifinais da Taça Guanabara',
  },
  {
    event: minimalEvent({
      id: '401863456',
      date: '2026-03-08T21:00Z',
      slug: 'taca-guanabara---final',
      home: { id: '3445', displayName: 'Fluminense' },
      away: { id: '819', displayName: 'Flamengo' },
    }),
    phase: 'TACA_GUANABARA_FINAL',
    roundLabel: 'Final da Taça Guanabara',
  },
  {
    event: minimalEvent({
      id: '401861653',
      date: '2026-02-20T23:00Z',
      slug: 'taca-rio---semifinals',
      home: { id: '10265', displayName: 'Bangu' },
      away: { id: '4806', displayName: 'Volta Redonda' },
    }),
    phase: 'TACA_RIO_SEMI_FINALS',
    roundLabel: 'Semifinais da Taça Rio',
  },
  {
    event: minimalEvent({
      id: '401863448',
      date: '2026-03-07T21:00Z',
      slug: 'taca-rio---final',
      home: { id: '6086', displayName: 'Botafogo' },
      away: { id: '10265', displayName: 'Bangu' },
    }),
    phase: 'TACA_RIO_FINAL',
    roundLabel: 'Final da Taça Rio',
  },
  {
    event: minimalEvent({
      id: '401860449',
      date: '2026-02-11T20:00Z',
      slug: 'relegation-stage',
      home: { id: '18134', displayName: 'Portuguesa-RJ' },
      away: { id: '6087', displayName: 'Nova Iguaçu' },
    }),
    phase: 'RELEGATION_STAGE',
    roundLabel: 'Rebaixamento',
  },
  // Mineiro
  {
    event: minimalEvent({
      id: '762136',
      date: '2026-01-10T19:00Z',
      slug: 'regular-season',
      home: { id: '9460', displayName: 'Uberlândia' },
      away: { id: '17339', displayName: 'Tombense' },
    }),
    phase: 'REGULAR_SEASON',
    roundLabel: 'Temporada regular',
  },
  {
    event: minimalEvent({
      id: '401861301',
      date: '2026-02-21T19:00Z',
      slug: 'trofeu-inconfidencia---semifinals',
      home: { id: '9460', displayName: 'Uberlândia' },
      away: { id: '131565', displayName: 'North EC' },
    }),
    phase: 'TROFEU_INCONFIDENCIA_SEMI_FINALS',
    roundLabel: 'Semifinais do Troféu Inconfidência',
  },
  {
    event: minimalEvent({
      id: '401863458',
      date: '2026-03-04T22:30Z',
      slug: 'trofeu-inconfidencia---finals',
      home: { id: '18399', displayName: 'URT' },
      away: { id: '131565', displayName: 'North EC' },
    }),
    phase: 'TROFEU_INCONFIDENCIA_FINAL',
    roundLabel: 'Final do Troféu Inconfidência',
  },
  {
    event: minimalEvent({
      id: '401861299',
      date: '2026-02-22T21:00Z',
      slug: 'playoffs---semifinals',
      home: { id: '7632', displayName: 'Atlético-MG' },
      away: { id: '6154', displayName: 'América Mineiro' },
    }),
    phase: 'PLAYOFFS_SEMI_FINALS',
    roundLabel: 'Semifinais dos playoffs',
  },
  {
    event: minimalEvent({
      id: '401863457',
      date: '2026-03-08T21:00Z',
      slug: 'playoffs---final',
      home: { id: '2022', displayName: 'Cruzeiro' },
      away: { id: '7632', displayName: 'Atlético-MG' },
    }),
    phase: 'PLAYOFFS_FINAL',
    roundLabel: 'Final dos playoffs',
  },
  // Gaúcho
  {
    event: minimalEvent({
      id: '401858984',
      date: '2026-02-06T19:00Z',
      slug: 'gaucho---relegation',
      home: { id: '21369', displayName: 'Guarany de Bagé' },
      away: { id: '22520', displayName: 'Monsoon' },
    }),
    phase: 'RELEGATION_STAGE',
    roundLabel: 'Rebaixamento',
  },
  {
    event: minimalEvent({
      id: '401860802',
      date: '2026-02-16T22:00Z',
      slug: 'farroupilha---semifinals',
      home: { id: '7391', displayName: 'São Luiz-RS' },
      away: { id: '17131', displayName: 'Caxias do Sul' },
    }),
    phase: 'FARROUPILHA_SEMI_FINALS',
    roundLabel: 'Semifinais do Farroupilha',
  },
  {
    event: minimalEvent({
      id: '401862381',
      date: '2026-03-02T22:00Z',
      slug: 'farroupilha---finals',
      home: { id: '7391', displayName: 'São Luiz-RS' },
      away: { id: '7388', displayName: 'Novo Hamburgo' },
    }),
    phase: 'FARROUPILHA_FINAL',
    roundLabel: 'Final do Farroupilha',
  },
  // Nordeste: finals (plural) já coberto pelo Paulista; group-stage preservado abaixo.
]

/** Slugs já mapeados antes do Ticket 08 (regressão mínima na mesma fronteira). */
const PRESERVED_PHASE_EVENTS: Array<{
  event: EspnScoreboardEvent
  phase: string
  roundLabel: string
}> = [
  {
    event: minimalEvent({
      id: '401864991',
      date: '2026-03-24T22:00Z',
      slug: 'group-stage',
      home: { id: '6195', displayName: 'Sociedade Imperatriz de Desportos' },
      away: { id: '20896', displayName: 'Retró' },
    }),
    phase: 'GROUP_STAGE',
    roundLabel: 'Fase de grupos',
  },
  {
    event: minimalEvent({
      id: '762011',
      date: '2026-01-11T00:00Z',
      slug: 'first-round',
      home: { id: '10266', displayName: 'Avenida' },
      away: { id: '6273', displayName: 'Grêmio' },
    }),
    phase: 'FIRST_ROUND',
    roundLabel: '1ª fase',
  },
  {
    event: minimalEvent({
      id: '401861578',
      date: '2026-02-21T23:30Z',
      slug: 'quarterfinals',
      home: { id: '2029', displayName: 'Palmeiras' },
      away: { id: '17635', displayName: 'Capivariano' },
    }),
    phase: 'QUARTER_FINALS',
    roundLabel: 'Quartas de final',
  },
  {
    event: minimalEvent({
      id: '401862317',
      date: '2026-03-01T23:30Z',
      slug: 'semifinals',
      home: { id: '2029', displayName: 'Palmeiras' },
      away: { id: '2026', displayName: 'São Paulo' },
    }),
    phase: 'SEMI_FINALS',
    roundLabel: 'Semifinais',
  },
]

function stubEspnBoard(events: EspnScoreboardEvent[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes(`/sports/soccer/${TEST_CODE}/scoreboard`)) {
        return new Response(JSON.stringify({ events }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }),
  )
}

async function withTestCompetition(run: () => Promise<void>): Promise<void> {
  ESPN_PRIMARY_COMPETITIONS[TEST_CODE] = {
    name: 'Regionais (teste parser)',
    slugPrefix: 'regionais-teste-parser',
    type: 'cup',
  }
  await run()
}

describe('parser ESPN fases regionais (fronteira HTTP)', () => {
  it('importa cada fase nova e preservada com rótulo PT-BR via POST /matches/sync → GET /matches', async () => {
    await withTestCompetition(async () => {
      const { sqlite, db } = createSqliteD1()
      handles.push(sqlite)
      const env = makeEnv(db)

      sqlite.exec(`
        INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
          ('u-admin', '${ADMIN_EMAIL}', 'google', 'g-admin', 'Admin'),
          ('u-pilot', '${PILOT_EMAIL}', 'google', 'g-pilot', 'Piloto');
        INSERT INTO profiles (user_id, nickname) VALUES
          ('u-admin', 'Admin'),
          ('u-pilot', 'Piloto');
      `)

      const adminToken = await signJwt({ sub: 'u-admin', email: ADMIN_EMAIL }, JWT_SECRET, 3600)
      const pilotToken = await signJwt({ sub: 'u-pilot', email: PILOT_EMAIL }, JWT_SECRET, 3600)

      const allCases = [...NEW_PHASE_EVENTS, ...PRESERVED_PHASE_EVENTS]
      // Datas futuras para o sync gravar status scheduled (mesmo padrão dos pilots).
      const events = allCases.map((c, idx) => {
        const ev = structuredClone(c.event)
        const future = new Date(Date.UTC(2099, 0, 10 + idx, 20, 0, 0))
          .toISOString()
          .replace(/:\d{2}\.\d{3}Z$/, 'Z')
        ev.date = future
        return ev
      })
      stubEspnBoard(events)

      const syncRes = await worker.fetch(
        new Request('https://api.palpitae.com/matches/sync', {
          method: 'POST',
          headers: {
            Cookie: `session=${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            competition: TEST_CODE,
            season: 2026,
            dates: ['20990110'],
          }),
        }),
        env,
        fakeExecutionCtx,
      )
      expect(syncRes.status).toBe(200)
      const syncBody = (await syncRes.json()) as {
        ok: boolean
        synced: { competitionId: string; matches: number }
      }
      expect(syncBody.ok).toBe(true)
      expect(syncBody.synced.matches).toBe(allCases.length)

      const matchesRes = await worker.fetch(
        new Request(
          `https://api.palpitae.com/matches?competition_id=${syncBody.synced.competitionId}`,
          { headers: { Cookie: `session=${pilotToken}` } },
        ),
        env,
        fakeExecutionCtx,
      )
      expect(matchesRes.status).toBe(200)
      const { matches } = (await matchesRes.json()) as {
        matches: Array<{
          id: string
          phase: string
          round: string
          round_label: string
          home_team_name: string
          away_team_name: string
        }>
      }
      expect(matches).toHaveLength(allCases.length)

      const byExternal = new Map(
        sqlite
          .prepare(`SELECT external_id, phase, round FROM matches WHERE competition_id = ?`)
          .all(syncBody.synced.competitionId)
          .map((row) => {
            const r = row as { external_id: string; phase: string; round: string }
            return [r.external_id, r]
          }),
      )

      for (const c of allCases) {
        const eventId = c.event.id as string
        const row = byExternal.get(eventId)
        expect(row, `evento ${eventId} slug=${c.event.season?.slug}`).toEqual({
          external_id: eventId,
          phase: c.phase,
          round: c.phase,
        })
        const apiMatch = matches.find((m) => {
          const dbRow = sqlite
            .prepare(`SELECT id FROM matches WHERE external_id = ?`)
            .get(eventId) as { id: string } | undefined
          return dbRow && m.id === dbRow.id
        })
        expect(apiMatch?.phase).toBe(c.phase)
        expect(apiMatch?.round).toBe(c.phase)
        expect(apiMatch?.round_label).toBe(c.roundLabel)
      }
    })
  })

  it('descarta slug desconhecido sem importar o evento (fail-closed)', async () => {
    await withTestCompetition(async () => {
      const { sqlite, db } = createSqliteD1()
      handles.push(sqlite)
      const env = makeEnv(db)

      sqlite.exec(`
        INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
          ('u-admin', '${ADMIN_EMAIL}', 'google', 'g-admin', 'Admin');
        INSERT INTO profiles (user_id, nickname) VALUES ('u-admin', 'Admin');
      `)

      const adminToken = await signJwt({ sub: 'u-admin', email: ADMIN_EMAIL }, JWT_SECRET, 3600)

      const known = minimalEvent({
        id: '762074',
        date: '2099-01-10T23:30Z',
        slug: 'league-phase',
        home: { id: '4773', displayName: 'Portuguesa' },
        away: { id: '2029', displayName: 'Palmeiras' },
      })
      const unknown = minimalEvent({
        id: '999999001',
        date: '2099-01-11T23:30Z',
        slug: 'mystery-stage-not-in-map',
        home: { id: '111', displayName: 'Time A' },
        away: { id: '222', displayName: 'Time B' },
      })
      stubEspnBoard([known, unknown])

      const syncRes = await worker.fetch(
        new Request('https://api.palpitae.com/matches/sync', {
          method: 'POST',
          headers: {
            Cookie: `session=${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            competition: TEST_CODE,
            season: 2026,
            dates: ['20990110'],
          }),
        }),
        env,
        fakeExecutionCtx,
      )
      expect(syncRes.status).toBe(200)
      const syncBody = (await syncRes.json()) as {
        ok: boolean
        synced: { matches: number }
      }
      expect(syncBody.ok).toBe(true)
      expect(syncBody.synced.matches).toBe(1)

      const rows = sqlite.prepare(`SELECT external_id, phase FROM matches`).all() as Array<{
        external_id: string
        phase: string
      }>
      expect(rows).toEqual([{ external_id: '762074', phase: 'LEAGUE_PHASE' }])
    })
  })
})
