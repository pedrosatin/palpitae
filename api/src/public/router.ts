import { Hono } from 'hono'
import type { AppContext } from '../types'

/**
 * Rotas públicas (sem `requireAuth`). Cada uma devolve o mínimo necessário para
 * um visitante anônimo ou um crawler; nada aqui pode expor dado de usuário.
 */
const router = new Hono<AppContext>()

// Formato e alfabeto de `generateInviteCode` (groups/router.ts): XXXX-XXXX sem
// I, O, 0 e 1. Validar antes de consultar evita bater no D1 com lixo e limita o
// que um scanner pode testar por requisição.
const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

// O preview tolera dados com até 5 min de atraso. A Function busca esta rota com
// cacheTtl de 5 min no edge, então picos de crawler não chegam ao D1.
const CACHE_OK = 'public, max-age=300'
const CACHE_MISS = 'public, max-age=60'

type InvitePreviewRow = {
  group_name: string
  competition_name: string | null
  member_count: number
}

/**
 * GET /public/invites/:code
 *
 * Dados do preview do link de convite (usado pela Pages Function de
 * `/convite/:code` para montar as meta tags Open Graph).
 *
 * Quem tem o código já pode entrar no grupo, então nome do grupo, campeonato e
 * total de membros não revelam nada além do que o convite já dá. Ficam de fora
 * ids, dono, membros, limite de vagas e configuração de pontuação.
 *
 * Response 200: { invite: { group_name, competition_name, member_count } }
 * Response 404: código com formato inválido, inexistente ou de grupo excluído.
 */
router.get('/invites/:code', async (c) => {
  const code = c.req.param('code').trim().toUpperCase()

  if (!INVITE_CODE_RE.test(code)) {
    c.header('Cache-Control', CACHE_MISS)
    return c.json({ error: 'Convite não encontrado' }, 404)
  }

  let row: InvitePreviewRow | null
  try {
    row = await c.env.DB.prepare(
      `SELECT
         g.name AS group_name,
         c.name AS competition_name,
         (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
       FROM groups g
       LEFT JOIN competitions c ON g.competition_id = c.id
       WHERE g.invite_code = ? AND g.deleted_at IS NULL`,
    )
      .bind(code)
      .first<InvitePreviewRow>()
  } catch (error) {
    console.error('[public] Error loading invite preview:', error)
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'Erro ao carregar convite' }, 500)
  }

  if (!row) {
    c.header('Cache-Control', CACHE_MISS)
    return c.json({ error: 'Convite não encontrado' }, 404)
  }

  c.header('Cache-Control', CACHE_OK)
  return c.json({
    invite: {
      group_name: row.group_name,
      competition_name: row.competition_name ?? null,
      member_count: Number(row.member_count) || 0,
    },
  })
})

export { router as publicRouter }
