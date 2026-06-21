import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from './auth/router'
import { competitionsRouter } from './competitions/router'
import { groupsRouter } from './groups/router'
import { pollActiveMatches } from './matches/poller'
import { matchesRouter } from './matches/router'
import { exportEventsToR2 } from './observability/export'
import { predictionsRouter } from './predictions/router'
import type { AppContext, Env } from './types'

// Cron do cold path diário (deve bater com wrangler.toml). Os demais ticks rodam o poller.
const DAILY_EXPORT_CRON = '5 0 * * *'

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
app.route('/competitions', competitionsRouter)
app.route('/groups', groupsRouter)
app.route('/matches', matchesRouter)
app.route('/predictions', predictionsRouter)

app.get('/health', (c) => c.json({ status: 'ok' }))

export default {
  fetch: app.fetch,

  // Cron Triggers (ver wrangler.toml). O controller.cron diz qual agendamento disparou.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === DAILY_EXPORT_CRON) {
      // Cold path — arquiva o dia ANTERIOR (já completo) no R2.
      const yesterday = new Date(controller.scheduledTime - 24 * 60 * 60 * 1000)
      ctx.waitUntil(exportEventsToR2(env, yesterday))
      return
    }

    // Result poller — resultados da janela ativa + pontuação (ADR-007).
    ctx.waitUntil(pollActiveMatches(env.DB, env.FOOTBALL_API_KEY ?? '', env.AE))
  },
}
