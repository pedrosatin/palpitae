import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requestLimits, clearExpiredSecurityRecords } from './security/limits'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
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
import { publicRouter } from './public/router'
import type { AppContext, Env } from './types'

// Cron do cold path diário (deve bater com wrangler.toml). Os demais ticks rodam o poller.
const DAILY_EXPORT_CRON = '5 0 * * *'
// Cron do lembrete de rodada (deve bater com wrangler.toml). 1x/dia.
const ROUND_REMINDER_CRON = '0 10 * * *'
// Cron de descoberta de jogos (deve bater com wrangler.toml). 1x/dia de madrugada
// (06:00 UTC = 03:00 BRT — sem jogos), busca novos confrontos das competições ativas.
const FIXTURE_DISCOVERY_CRON = '0 6 * * *'

const app = new Hono<AppContext>()

app.use('*', secureHeaders())

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!origin) return null
      if (origin === c.env.FRONTEND_URL) {
        return origin
      }
      return null
    },
    credentials: true,
  }),
)

app.use(
  '*',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'Body excede o limite de 64 KiB' }, 413),
  }),
)
app.use('*', requestLimits)

app.route('/auth', authRouter)
app.route('/competitions', competitionsRouter)
app.route('/groups', groupsRouter)
app.route('/matches', matchesRouter)
app.route('/predictions', predictionsRouter)
app.route('/notifications', notificationsRouter)
app.route('/metrics', metricsRouter)
// Rotas sem autenticação. Devolvem só o que quem tem o link já vê (ver public/router.ts).
app.route('/public', publicRouter)

app.get('/health', (c) => c.json({ status: 'ok' }))

export default {
  fetch: app.fetch,

  // Cron Triggers (ver wrangler.toml). O controller.cron diz qual agendamento disparou.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(clearExpiredSecurityRecords(env.DB))
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
