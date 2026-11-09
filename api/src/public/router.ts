import { Hono } from 'hono'
import { logEvent } from '../observability'
import { PROXY_SECRET_HEADER, sameSecret } from '../security/limits'
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
// `cacheTtlByStatus` (200 por 5 min, 404 por 1 min), e aberturas repetidas do link
// não chegam ao D1.
const CACHE_OK = 'public, max-age=300'
const CACHE_MISS = 'public, max-age=60'

type InvitePreviewRow = {
  group_name: string
  competition_name: string | null
  member_count: number
  admin_name: string | null
  points_exact: number | null
  points_winner: number | null
}

/**
 * Primeiro nome do dono do grupo. O visitante só precisa reconhecer quem o
 * convidou, então o nome completo fica para quem já entrou no grupo. Texto com
 * `@` nunca sai daqui, porque pode ser um e-mail usado como nome.
 */
export function publicAdminName(raw: string | null | undefined): string | null {
  const first = raw?.trim().split(/\s+/)[0] ?? ''
  if (!first || first.includes('@')) return null
  return first
}

/**
 * GET /public/invites/:code
 *
 * Dados do convite para quem ainda não entrou: a Pages Function de
 * `/convite/:code` monta as meta tags com eles e a página de convite da SPA
 * mostra o grupo ao visitante.
 *
 * Quem tem o código já pode entrar no grupo, então nome do grupo, campeonato,
 * total de membros, regra de pontuação e primeiro nome do dono não revelam nada
 * além do que o convite já dá. Ficam de fora ids, e-mails, demais membros,
 * palpites e limite de vagas.
 *
 * Response 200: { invite: { group_name, competition_name, member_count, admin_name, points_exact, points_winner } }
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
         (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
         COALESCE(NULLIF(TRIM(p.nickname), ''), NULLIF(TRIM(u.user_name), '')) AS admin_name,
         g.points_exact AS points_exact,
         g.points_winner AS points_winner
       FROM groups g
       LEFT JOIN competitions c ON g.competition_id = c.id
       LEFT JOIN users u ON u.id = g.owner_user_id
       LEFT JOIN profiles p ON p.user_id = g.owner_user_id
       WHERE g.invite_code = ? AND g.deleted_at IS NULL AND (c.visibility IS NULL OR c.visibility != 'pilot')`,
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
      admin_name: publicAdminName(row.admin_name),
      points_exact: row.points_exact ?? null,
      points_winner: row.points_winner ?? null,
    },
  })
})

/**
 * POST /public/invite-opens
 *
 * Conta uma abertura de `/convite/:code`. Quem chama é a Pages Function, que já
 * filtrou crawlers e pré-busca, e o segredo do proxy impede que outra origem
 * infle o funil. Sem o segredo configurado, a rota fica fechada.
 *
 * O pedido não carrega código nem dado de quem abriu, e o evento grava só o tipo.
 * A contagem não mora em `GET /public/invites/:code` porque essa rota passa pelo
 * cache do edge, serve crawlers e a SPA também pode chamá-la.
 *
 * Response 204: abertura registrada. Response 403: segredo ausente ou errado.
 */
router.post('/invite-opens', async (c) => {
  const expected = c.env.PROXY_SHARED_SECRET
  const provided = c.req.header(PROXY_SECRET_HEADER)
  if (!expected || !provided || !(await sameSecret(provided, expected))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  logEvent(c.env.AE, 'invite_opened')
  return c.body(null, 204)
})

export { router as publicRouter }
