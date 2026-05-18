import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRouter } from './auth/router'
import { competitionsRouter } from './competitions/router'
import { groupsRouter } from './groups/router'
import { matchesRouter } from './matches/router'
import { predictionsRouter } from './predictions/router'
import type { AppContext } from './types'

const app = new Hono<AppContext>()

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return null
      if (
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

export default app
