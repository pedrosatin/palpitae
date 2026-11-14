import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { defaultCacheControl } from './security/cacheControl'
import { requestLimits, clearExpiredSecurityRecords } from './security/limits'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { authRouter } from './auth/router'
import { competitionsRouter } from './competitions/router'
import {
  DAILY_EXPORT_CRON,
  FIXTURE_DISCOVERY_CRON,
  RESULT_POLLER_CRON,
  ROUND_REMINDER_CRON,
} from './crons'
import { jsonError, jsonNotFound } from './errorHandlers'
import { groupsRouter } from './groups/router'
import { discoverFixtures } from './matches/fixtureDiscovery'
import { pollActiveMatches } from './matches/poller'
import { matchesRouter } from './matches/router'
import { notificationsRouter } from './notifications/router'
import { reminderFetchBudget, sendRoundReminders } from './notifications/roundReminder'
import { unsubSigningSecret } from './notifications/unsubscribeToken'
import { logError, tryLogEvent } from './observability/events'
import { exportRecentDays } from './observability/export'
import { metricsRouter } from './observability/metricsRouter'
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
// Rotas sem autenticação. Devolvem só o que quem tem o link já vê (ver public/router.ts).
app.route('/public', publicRouter)

app.get('/health', (c) => c.json({ status: 'ok' }))

// Rota inexistente e exceção não tratada também respondem JSON com `{ error }`.
app.notFound(jsonNotFound)
app.onError(jsonError)

export default {
  fetch: app.fetch,

  // Cron Triggers (ver wrangler.toml). O controller.cron diz qual agendamento disparou.
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
      // Cold path — arquiva o dia ANTERIOR e faz backfill de dias faltantes no R2.
      ctx.waitUntil(exportRecentDays(env, new Date(controller.scheduledTime)))
      return
    }

    if (controller.cron === FIXTURE_DISCOVERY_CRON) {
      // Descobre jogos novos (mata-mata, remarcações) das competições ativas.
      ctx.waitUntil(
        discoverFixtures(env.DB, env.FOOTBALL_API_KEY ?? '', env.AE, controller.scheduledTime),
      )
      return
    }

    if (controller.cron === ROUND_REMINDER_CRON) {
      // E-mail do dia para quem tem jogo de hoje sem palpite (1x/dia).
      ctx.waitUntil(
        sendRoundReminders(
          env.DB,
          env.RESEND_API_KEY ?? '',
          env.AE,
          env.FRONTEND_URL,
          env.BASE_URL ? { secret: unsubSigningSecret(env), apiBaseUrl: env.BASE_URL } : undefined,
          undefined,
          { fetchBudget: reminderFetchBudget(env.REMINDER_FETCH_BUDGET), pilotAccess: env },
        ),
      )
      return
    }

    if (controller.cron === RESULT_POLLER_CRON) {
      // Result poller — resultados da janela ativa + pontuação (ADR-007).
      ctx.waitUntil(
        pollActiveMatches(env.DB, env.FOOTBALL_API_KEY ?? '', env.AE, controller.scheduledTime),
      )
      return
    }

    // Cron do wrangler.toml sem ramo aqui: registra em vez de rodar o poller no lugar.
    console.error(`[scheduled] Cron desconhecido: ${controller.cron}`)
    tryLogEvent(env.AE, 'scheduled_unknown_cron', { blobs: [controller.cron] })
  },
}
