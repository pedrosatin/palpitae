import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { defaultCacheControl } from './security/cacheControl'
import { requestLimits, clearExpiredSecurityRecords } from './security/limits'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { adminRouter } from './admin/router'
import { authRouter } from './auth/router'
import { competitionsRouter } from './competitions/router'
import {
  DAILY_EXPORT_CRON,
  FIXTURE_DISCOVERY_CRON,
  isResultPollerTick,
  LEGACY_RESULT_POLLER_CRON,
  POLLER_AND_DRAIN_CRON,
  ROUND_REMINDER_CRON,
} from './crons'
import { jsonError, jsonNotFound } from './errorHandlers'
import { groupsRouter } from './groups/router'
import { runProviderDrains } from './matches/drainCoordinator'
import { espnDrain } from './matches/espnWork'
import { footballDataDrain } from './matches/fdWork'
import { DISCOVERY_CALL_BUDGET, discoverFixtures } from './matches/fixtureDiscovery'
import { pollActiveMatches } from './matches/poller'
import { matchesRouter } from './matches/router'
import { notificationsRouter } from './notifications/router'
import { mailjetCredentials } from './notifications/mailjet'
import { reminderFetchBudget, sendRoundReminders } from './notifications/roundReminder'
import { unsubSigningSecret } from './notifications/unsubscribeToken'
import { logError, tryLogEvent } from './observability/events'
import { exportRecentDays } from './observability/export'
import { metricsRouter } from './observability/metricsRouter'
import { checkQuotaUsage } from './observability/quotaUsage'
import { predictionsRouter } from './predictions/router'
import { publicRouter } from './public/router'
import type { AppContext, Env } from './types'

// Configurações opcionais cuja ausência desativa funções sem aviso.
const OPTIONAL_CONFIG = [
  'AE',
  'EVENTS',
  'PROXY_SHARED_SECRET',
  'BASE_URL',
  'CF_ACCOUNT_ID',
  'AE_SQL_TOKEN',
  'CF_ANALYTICS_TOKEN',
] as const

/** Registra, uma vez por execução agendada, cada configuração opcional ausente. */
function reportMissingConfig(env: Env): void {
  const missing = OPTIONAL_CONFIG.filter((name) => !env[name])
  if (missing.length === 0) return
  // Sem `AE` o evento não tem onde ser gravado: o aviso fica só no log.
  console.error(`[scheduled] Configuração ausente: ${missing.join(', ')}`)
  for (const name of missing) tryLogEvent(env.AE, 'scheduled_config_missing', { blobs: [name] })
}

const app = new Hono<AppContext>()

// Primeiro da fila, para cobrir também o que os middlewares seguintes respondem sozinhos.
app.use('*', defaultCacheControl)
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
app.route('/admin', adminRouter)
// Rotas sem autenticação. Devolvem só o que quem tem o link já vê (ver public/router.ts).
app.route('/public', publicRouter)

app.get('/health', (c) => c.json({ status: 'ok' }))

app.notFound(jsonNotFound)
app.onError(jsonError)

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      clearExpiredSecurityRecords(env.DB).catch((error: unknown) =>
        logError(
          env.AE,
          'security_storage_error',
          '[limits] Limpeza de registros expirados falhou:',
          error,
          { blobs: ['cleanup'] },
        ),
      ),
    )
    reportMissingConfig(env)

    if (controller.cron === DAILY_EXPORT_CRON) {
      ctx.waitUntil(exportRecentDays(env, new Date(controller.scheduledTime)))
      // Uso das cotas do plano Free no dia anterior. Não lança: falha não afeta o export.
      ctx.waitUntil(checkQuotaUsage(env, new Date(controller.scheduledTime)))
      return
    }

    if (controller.cron === FIXTURE_DISCOVERY_CRON) {
      ctx.waitUntil(
        // O saldo de subrequests da invocação vale para a football-data e a ESPN juntas.
        discoverFixtures(env.DB, env.FOOTBALL_API_KEY ?? '', env.AE, controller.scheduledTime, {
          callBudget: DISCOVERY_CALL_BUDGET,
        }),
      )
      return
    }

    if (controller.cron === ROUND_REMINDER_CRON) {
      ctx.waitUntil(
        sendRoundReminders(
          env.DB,
          env.RESEND_API_KEY ?? '',
          env.AE,
          env.FRONTEND_URL,
          env.BASE_URL ? { secret: unsubSigningSecret(env), apiBaseUrl: env.BASE_URL } : undefined,
          undefined,
          {
            fetchBudget: reminderFetchBudget(env.REMINDER_FETCH_BUDGET),
            pilotAccess: env,
            mailjet: mailjetCredentials(env.MAILJET_API_KEY, env.MAILJET_API_SECRET),
          },
        ),
      )
      return
    }

    if (controller.cron === LEGACY_RESULT_POLLER_CRON) {
      ctx.waitUntil(
        pollActiveMatches(
          env.DB,
          env.FOOTBALL_API_KEY ?? '',
          env.AE,
          controller.scheduledTime,
          env,
        ),
      )
      return
    }

    if (controller.cron === POLLER_AND_DRAIN_CRON) {
      if (isResultPollerTick(controller.scheduledTime)) {
        ctx.waitUntil(
          pollActiveMatches(
            env.DB,
            env.FOOTBALL_API_KEY ?? '',
            env.AE,
            controller.scheduledTime,
            env,
          ),
        )
      } else {
        ctx.waitUntil(
          runProviderDrains(
            env.DB,
            [
              footballDataDrain({ apiKey: env.FOOTBALL_API_KEY ?? '', ae: env.AE }),
              espnDrain({ ae: env.AE }),
            ],
            { ae: env.AE },
          ),
        )
      }
      return
    }

    // Cron do wrangler.toml sem ramo aqui: registra em vez de rodar o poller no lugar.
    console.error(`[scheduled] Cron desconhecido: ${controller.cron}`)
    tryLogEvent(env.AE, 'scheduled_unknown_cron', { blobs: [controller.cron] })
  },
}
