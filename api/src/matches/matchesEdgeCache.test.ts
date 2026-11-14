/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { scoreUnprocessedMatches } from './scoring'

/**
 * Cache de borda de GET /matches com o SQL de produção. O `caches.default`
 * substituto guarda a resposta pela URL da chave, como o Cache API da
 * Cloudflare, e registra o Cache-Control de cada resposta guardada.
 */

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function stubEdgeCache() {
  const store = new Map<string, Response>()
  vi.stubGlobal('caches', {
    default: {
      async match(key: Request) {
        return store.get(key.url)?.clone()
      },
      async put(key: Request, response: Response) {
        store.set(key.url, response)
      },
    },
  })
  return store
}

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('member','member@example.com','google','1');
    INSERT INTO profiles (user_id,nickname) VALUES ('member','Member');
    INSERT INTO competitions (id,name,slug,status,penalty_phases)
      VALUES ('competition','League','test-league','finished','[]');
    INSERT INTO teams (id,name,slug) VALUES ('home','Home','home'),('away','Away','away');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,
                         start_time,status,home_score,away_score,round,scored_at)
      VALUES ('m1','competition','1','football-data','home','away','2026-05-01T19:00:00Z',
              'finished',1,0,'38','2026-05-01T21:00:00.000Z'),
             ('m2','competition','2','football-data','away','home','2026-05-01T21:00:00Z',
              'finished',2,2,'38','2026-05-01T23:00:00.000Z');
  `)
  // Conta as consultas da lista de jogos: um HIT do cache não chega nelas.
  let listQueries = 0
  const countedDb = {
    ...db,
    prepare(sql: string) {
      if (sql.includes('FROM matches m')) listQueries++
      return db.prepare(sql)
    },
    batch: db.batch.bind(db),
  } as D1Database
  const env = {
    DB: countedDb,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
  } as Env
  const token = await signJwt(
    { sub: 'member', email: 'member@example.com', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3600,
  )
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const getMatches = async () => {
    const response = await worker.fetch(
      new Request('https://api.palpitae.com.br/matches?competition_id=competition&round_order=1', {
        headers: { Cookie: `session=${token}`, 'CF-Connecting-IP': '192.0.2.1' },
      }),
      env,
      ctx,
    )
    // Deixa o cache.put do waitUntil terminar antes da próxima requisição.
    await Promise.all(pending.splice(0))
    return response
  }
  return { sqlite, db, getMatches, listQueries: () => listQueries }
}

type MatchesBody = { matches: { id: string; home_score: number; away_score: number }[] }

describe('GET /matches com cache de borda', () => {
  it('competição sem mudança continua no cache longo, sem consultar a lista no D1', async () => {
    const store = stubEdgeCache()
    const { getMatches, listQueries } = await fixture()

    expect((await getMatches()).status).toBe(200)
    expect(listQueries()).toBe(1)
    const [stored] = [...store.values()]
    expect(stored.headers.get('Cache-Control')).toBe('public, max-age=86400')

    const second = await getMatches()
    expect(second.status).toBe(200)
    expect(listQueries()).toBe(1)
    expect(((await second.json()) as MatchesBody).matches.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('competição rebaixada a piloto responde 404 na requisição seguinte', async () => {
    stubEdgeCache()
    const { sqlite, getMatches } = await fixture()

    expect((await getMatches()).status).toBe(200)

    sqlite.exec("UPDATE competitions SET visibility = 'pilot' WHERE id = 'competition'")

    const response = await getMatches()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Competição não encontrada' })
  })

  it('placar corrigido e repontuado aparece na requisição seguinte', async () => {
    stubEdgeCache()
    const { sqlite, db, getMatches } = await fixture()

    expect((await getMatches()).status).toBe(200)

    // A sincronização grava o placar novo e devolve o jogo à fila de pontuação.
    sqlite.exec("UPDATE matches SET home_score = 3, scored_at = NULL WHERE id = 'm1'")
    await scoreUnprocessedMatches('competition', db)

    const response = await getMatches()
    expect(response.status).toBe(200)
    const body = (await response.json()) as MatchesBody
    expect(body.matches.find((m) => m.id === 'm1')).toMatchObject({ home_score: 3, away_score: 0 })
  })

  it('o navegador revalida em 60s mesmo quando a borda guarda por 24h', async () => {
    stubEdgeCache()
    const { getMatches } = await fixture()

    const miss = await getMatches()
    expect(miss.headers.get('Cache-Control')).toBe('private, max-age=60')
    const hit = await getMatches()
    expect(hit.headers.get('Cache-Control')).toBe('private, max-age=60')
  })
})
