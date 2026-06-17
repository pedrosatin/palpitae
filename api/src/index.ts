import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from './auth/router'
import { bracketRouter } from './bracket/router'
import { competitionsRouter } from './competitions/router'
import { groupsRouter } from './groups/router'
import { pollActiveMatches } from './matches/poller'
import { matchesRouter } from './matches/router'
import { predictionsRouter } from './predictions/router'
import type { AppContext, Env } from './types'

const app = new Hono<AppContext>()

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return null
      if (
        origin === 'https://palpitae.com.br' ||
        origin.endsWith('.palpitae.com.br') ||
        origin === 'http://localhost:5173'
      ) {
        return origin
      }
      return null
    },
    credentials: true,
  }),
)

app.route('/auth', authRouter)
app.route('/bracket', bracketRouter)
app.route('/competitions', competitionsRouter)
app.route('/groups', groupsRouter)
app.route('/matches', matchesRouter)
app.route('/predictions', predictionsRouter)

app.get('/health', (c) => c.json({ status: 'ok' }))

export default {
  fetch: app.fetch,

  // Cron Trigger — busca resultados de jogos na janela ativa e pontua (ADR-007).
  // Agendado em wrangler.toml: "0,30 * * * *" (a cada 30 min).
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pollActiveMatches(env.DB, env.FOOTBALL_API_KEY ?? ''))
  },
}
