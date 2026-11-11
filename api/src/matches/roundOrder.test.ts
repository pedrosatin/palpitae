import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createSqliteD1 } from '../testing/sqliteD1'
import { signJwt } from '../auth/jwt'
import { matchesRouter } from './router'
import { predictionsRouter } from '../predictions/router'
import type { AppContext } from '../types'

// Formatos gravados pelos syncs: a ESPN grava o número da semana na temporada
// regular e o código da fase nas copas (`resolveEspnRound`); a football-data
// grava o número nas fases de pontos, o código no mata-mata e `FASE_N` nas
// demais (`mapRound`).
const cases = [
  {
    name: 'Brasileirão com jogo adiado',
    rounds: ['19', '37', '38'],
    phases: ['REGULAR_SEASON', 'REGULAR_SEASON', 'REGULAR_SEASON'],
    dates: [8, 4, 6],
    expected: ['19', '37', '38'],
  },
  {
    name: 'Liga com fase nula ou divergente',
    rounds: ['1', '2', '3', '4', '5'],
    phases: ['REGULAR_SEASON', null, 'LEAGUE_STAGE', 'REGULAR_SEASON', 'REGULAR_SEASON'],
    dates: [2, 4, 5, 6, 8],
    expected: ['1', '2', '3', '4', '5'],
  },
  {
    name: 'Fases com a mesma menor data',
    rounds: ['2', 'LAST_16', '1'],
    phases: ['LEAGUE_STAGE', 'LAST_16', 'LEAGUE_STAGE'],
    dates: [2, 2, 2],
    expected: ['1', '2', 'LAST_16'],
  },
  {
    name: 'Copa do Mundo',
    rounds: ['3', 'LAST_32'],
    phases: ['GROUP_STAGE', 'LAST_32'],
    dates: [2, 4],
    expected: ['3', 'LAST_32'],
  },
  {
    name: 'Libertadores',
    rounds: ['FIRST_STAGE', 'GROUP_STAGE', 'LAST_16'],
    phases: ['FIRST_STAGE', 'GROUP_STAGE', 'LAST_16'],
    dates: [2, 4, 8],
    expected: ['FIRST_STAGE', 'GROUP_STAGE', 'LAST_16'],
  },
  {
    name: 'Copa do Brasil',
    rounds: ['FIRST_ROUND', 'THIRD_ROUND'],
    phases: ['FIRST_ROUND', 'THIRD_ROUND'],
    dates: [2, 4],
    expected: ['FIRST_ROUND', 'THIRD_ROUND'],
  },
  {
    name: 'Champions',
    rounds: ['8', 'LAST_16'],
    phases: ['LEAGUE_STAGE', 'LAST_16'],
    dates: [2, 4],
    expected: ['8', 'LAST_16'],
  },
  {
    name: 'Brasileirão com jogo antecipado',
    rounds: ['19', '20', '21'],
    phases: ['REGULAR_SEASON', 'REGULAR_SEASON', 'REGULAR_SEASON'],
    dates: [4, 2, 6],
    expected: ['19', '20', '21'],
  },
  {
    name: 'Carioca',
    rounds: ['TACA_GUANABARA', 'SEMI_FINALS'],
    phases: ['TACA_GUANABARA', 'SEMI_FINALS'],
    dates: [2, 4],
    expected: ['TACA_GUANABARA', 'SEMI_FINALS'],
  },
]

describe('Ordem de rodadas nas respostas HTTP', () => {
  for (const scenario of cases) {
    for (const [url, key] of [
      ['/matches?competition_id=order-c', 'matches'],
      ['/predictions/user?group_id=order-g&user_id=order-u', 'predictions'],
    ]) {
      it(`${scenario.name} em GET ${url.split('?')[0]}`, async () => {
        const { sqlite, db } = createSqliteD1()
        try {
          sqlite.exec(`
          INSERT INTO competitions (id, name, slug, status) VALUES ('order-c', 'Teste', 'order-c', 'ongoing');
          INSERT INTO teams (id, name, slug) VALUES ('order-h', 'Casa', 'order-h'), ('order-a', 'Fora', 'order-a');
          INSERT INTO users (id, email, provider, provider_id) VALUES ('order-u', 'order@test.com', 'google', 'order-u');
          INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES ('order-g', 'Teste', 'order-c', 'order-u', 'ORDER');
          INSERT INTO group_members (id, group_id, user_id, role) VALUES ('order-gm', 'order-g', 'order-u', 'owner');
        `)
          scenario.rounds.forEach((round, i) => {
            sqlite
              .prepare(`INSERT INTO matches (id, external_id, provider, competition_id, home_team_id, away_team_id, round, phase, group_name, start_time, status)
            VALUES (?, ?, 'test', 'order-c', 'order-h', 'order-a', ?, ?, ?, ?, 'scheduled')`)
              .run(
                `order-${i}`,
                `order-${i}`,
                round,
                scenario.phases[i],
                scenario.phases[i] === 'GROUP_STAGE' ? 'A' : null,
                `2026-0${scenario.dates[i]}-01T12:00:00Z`,
              )
          })
          const app = new Hono<AppContext>()
          app.route('/matches', matchesRouter)
          app.route('/predictions', predictionsRouter)
          const token = await signJwt({ sub: 'order-u', email: 'order@test.com' }, 'secret', 3600)
          const env = { DB: db, JWT_SECRET: 'secret' } as AppContext['Bindings']
          {
            const res = await app.fetch(
              new Request(`http://localhost${url}`, { headers: { Cookie: `session=${token}` } }),
              env,
            )
            expect(res.status).toBe(200)
            const body = (await res.json()) as Record<
              string,
              { round: string; is_knockout: boolean }[]
            >
            expect(body[key].map((m) => m.round)).toEqual(scenario.expected)
            expect(body[key].map((m) => m.is_knockout)).toEqual(
              scenario.expected.map((r) =>
                [
                  'FIRST_STAGE',
                  'FIRST_ROUND',
                  'THIRD_ROUND',
                  'LAST_16',
                  'LAST_32',
                  'SEMI_FINALS',
                ].includes(r),
              ),
            )
          }
        } finally {
          sqlite.close()
        }
      })
    }
  }
})
