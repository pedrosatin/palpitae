import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from './auth/router'
import { competitionsRouter } from './competitions/router'
import { groupsRouter } from './groups/router'
import { discoverFixtures } from './matches/fixtureDiscovery'
import { pollActiveMatches } from './matches/poller'
import { matchesRouter } from './matches/router'
import { notificationsRouter } from './notifications/router'
import { sendRoundReminders } from './notifications/roundReminder'
import { exportRecentDays } from './observability/export'
import { metricsRouter } from './observability/metricsRouter'
import { predictionsRouter } from './predictions/router'
import type { AppContext, Env } from './types'

// Cron do cold path diário (deve bater com wrangler.toml). Os demais ticks rodam o poller.
const DAILY_EXPORT_CRON = '5 0 * * *'
// Cron do lembrete de rodada (deve bater com wrangler.toml). 1x/dia.
const ROUND_REMINDER_CRON = '0 10 * * *'
// Cron de descoberta de jogos (deve bater com wrangler.toml). 1x/dia de madrugada
// (06:00 UTC = 03:00 BRT — sem jogos), busca novos confrontos das competições ativas.
const FIXTURE_DISCOVERY_CRON = '0 6 * * *'

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
app.route('/notifications', notificationsRouter)
app.route('/metrics', metricsRouter)

app.get('/health', (c) => c.json({ status: 'ok' }))

export default {
  fetch: app.fetch,

  // Cron Triggers (ver wrangler.toml). O controller.cron diz qual agendamento disparou.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === DAILY_EXPORT_CRON) {
      // Cold path — arquiva o dia ANTERIOR e faz backfill de dias faltantes no R2.
      ctx.waitUntil(exportRecentDays(env, new Date(controller.scheduledTime)))
      return
    }

    if (controller.cron === FIXTURE_DISCOVERY_CRON) {
      // Descobre jogos novos (mata-mata, remarcações) das competições ativas.
      ctx.waitUntil(discoverFixtures(env.DB, env.FOOTBALL_API_KEY ?? '', env.AE))
      return
    }

    if (controller.cron === ROUND_REMINDER_CRON) {
      // Lembrete de rodadas que começam amanhã (1x/dia).
      ctx.waitUntil(
        sendRoundReminders(
          env.DB,
          env.RESEND_API_KEY ?? '',
          env.AE,
          env.FRONTEND_URL,
          env.BASE_URL ? { secret: env.JWT_SECRET, apiBaseUrl: env.BASE_URL } : undefined,
        ),
      )
      return
    }

    // Result poller — resultados da janela ativa + pontuação (ADR-007).
    ctx.waitUntil(pollActiveMatches(env.DB, env.FOOTBALL_API_KEY ?? '', env.AE))
  },
}
