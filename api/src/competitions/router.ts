import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { hasPilotAccess, isAdminUser } from '../auth/permissions'
import { parsePenaltyPhases } from '../matches/penalties'
import type { AppContext } from '../types'

const router = new Hono<AppContext>()

/**
 * GET /competitions
 *
 * Lista as competições disponíveis para o usuário autenticado.
 * Competições com visibility 'pilot' aparecem apenas para o administrador e
 * para os convidados listados em PILOT_EMAILS.
 */
router.get('/', requireAuth, async (c) => {
  const db = c.env.DB
  const canSeePilot = hasPilotAccess(c.get('userEmail'), c.env)

  try {
    // `competitions.status` nasce 'upcoming' e não é mantido pelo sync, então o
    // `status` devolvido aqui é derivado dos jogos reais (mesma regra de
    // groups/router.ts): acabou quando tem partidas e nenhuma pendente; está em
    // andamento quando tem partidas encerradas e ainda há pendentes. Sem jogos,
    // vale a coluna.
    const result = await db
      .prepare(
        `SELECT
           c.id, c.name, c.slug, c.season, c.penalty_phases, c.visibility,
           CASE
             WHEN c.status = 'finished' THEN 'finished'
             WHEN NOT EXISTS (
               SELECT 1 FROM matches m WHERE m.competition_id = c.id
             ) THEN c.status
             WHEN NOT EXISTS (
               SELECT 1 FROM matches m
               WHERE m.competition_id = c.id AND m.status != 'finished'
             ) THEN 'finished'
             WHEN EXISTS (
               SELECT 1 FROM matches m
               WHERE m.competition_id = c.id AND m.status = 'finished'
             ) THEN 'ongoing'
             ELSE c.status
           END AS status
         FROM competitions c
         ORDER BY c.name ASC`,
      )
      .all<Record<string, unknown>>()

    const visibleRows = canSeePilot
      ? result.results
      : result.results.filter((row) => row.visibility !== 'pilot')

    const competitions = visibleRows.map(
      ({ penalty_phases, visibility: _visibility, ...rest }) => ({
        ...rest,
        has_penalty_phases: parsePenaltyPhases(penalty_phases as string | null).length > 0,
      }),
    )

    c.header('Cache-Control', 'private, no-store')

    return c.json({ competitions })
  } catch (error) {
    console.error('Error fetching competitions:', error)
    return c.json({ error: 'Erro ao carregar competições' }, 500)
  }
})

/**
 * POST /competitions/:id/promote
 *
 * Promove manualmente uma competição para visibilidade pública.
 * Restrito ao administrador configurado em ADMIN_EMAIL.
 */
router.post('/:id/promote', requireAuth, async (c) => {
  if (!isAdminUser(c.get('userEmail'), c.env)) {
    return c.json({ error: 'Apenas o administrador pode promover competições' }, 403)
  }

  const idOrSlug = c.req.param('id')
  const db = c.env.DB

  try {
    const existing = await db
      .prepare('SELECT id, slug FROM competitions WHERE id = ? OR slug = ?')
      .bind(idOrSlug, idOrSlug)
      .first<{ id: string; slug: string }>()

    if (!existing) {
      return c.json({ error: 'Competição não encontrada' }, 404)
    }

    await db
      .prepare("UPDATE competitions SET visibility = 'public' WHERE id = ?")
      .bind(existing.id)
      .run()

    return c.json({
      ok: true,
      competition: {
        id: existing.id,
        slug: existing.slug,
        visibility: 'public',
      },
    })
  } catch (error) {
    console.error('Error promoting competition:', error)
    return c.json({ error: 'Erro ao promover competição' }, 500)
  }
})

export { router as competitionsRouter }
