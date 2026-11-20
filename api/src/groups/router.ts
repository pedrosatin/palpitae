import { Hono } from 'hono'
import type { Context } from 'hono'
import { hasFeatureAccess, hasPilotAccess } from '../auth/permissions'
import { validateJson } from '../http/validateJson'
import { requireAuth } from '../auth/middleware'
import { hashUserId, logEvent, logRequestPerf } from '../observability'
import { parseClientEntryMethod, readRecentSignupFlag } from '../observability/inviteFunnel'
import type { AppContext } from '../types'
import { getGroupMembership, isPilotGroupBlocked, memberDisplaySql } from './membership'
import { parseGroupName } from './groupName'
import {
  createGroupSchema,
  joinGroupSchema,
  mapCreateGroupError,
  mapJoinGroupError,
  mapPatchGroupError,
  patchGroupSchema,
} from './writeSchemas'
import {
  ACTIVE_GROUPS_OWNED_COUNT_SQL,
  ACTIVE_MEMBERSHIPS_COUNT_SQL,
  CREATE_MEMBERSHIP_CAP_ERROR,
  MAX_ACTIVE_GROUPS_OWNED,
  MAX_ACTIVE_MEMBERSHIPS,
  OWNED_CAP_ERROR,
} from './groupCaps'
import { classifiedRuleChangeStatements } from '../matches/scoring'
import { roundAgreement, roundLabel } from '../matches/rounds'
import {
  parsePendingSummary,
  type PendingSummary,
  withMissingPenalties,
} from './pendingPredictions'
import { missingPenalties } from './missingPenalties'
import { fetchDeadlineMatches, groupsListBinds, groupsListSql, type DeadlineMatch } from './groupsList'
import { fetchLiveMatchesByCompetition } from './liveMatches'
import { competitionStatusSql } from './competitionStatus'
import { getRoundStandings } from './roundStandings'
import { notBannedSql, rankingOrderSql, userPositionSql } from './ranking'
import { tryInsertGroupMember } from './joinMember'
import { generatePublicId } from './joinRequests'
import { registerJoinRequestRoutes } from './joinRequestRoutes'

const router = new Hono<AppContext>()

// Campos comuns às linhas de grupo dos dois GETs (lista e detalhe). Um campo novo
// vindo do JOIN entra aqui uma vez, em vez de em dois tipos inline.
type GroupRow = {
  id: string
  name: string
  competition_id: string
  competition_name: string | null
  competition_type: 'league' | 'cup' | null
  /** Código canônico da competição (`competitions.external_id`). */
  competition_code: string | null
  competition_status: 'upcoming' | 'ongoing' | 'finished' | null
  admin_id: string
  invite_code: string
  created_at: string
  member_count: number
}

// Pódio de um grupo encerrado: os 3 primeiros do leaderboard + flag de quem é o
// próprio usuário (calculada no servidor para o card não precisar do id do user).
type PodiumEntry = {
  position: number
  display: string
  points: number
  is_you: boolean
}

/** Texto sem espaços nas pontas, ou `undefined` quando o campo não é texto. */
/**
 * Generates a readable invite code in the format XXXX-XXXX (uppercase alphanumeric).
 */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars (I, O, 0, 1)
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  const raw = Array.from(array)
    .map((b) => chars[b % chars.length])
    .join('')
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/**
 * Sorteia 5 códigos e devolve o primeiro que ainda não existe, ou null se todos
 * colidirem. Usado na criação do grupo e na troca de convite.
 */
async function pickUniqueInviteCode(db: D1Database): Promise<string | null> {
  const candidates = Array.from({ length: 5 }, () => generateInviteCode())
  const placeholders = candidates.map(() => '?').join(',')
  const existing = await db
    .prepare(`SELECT invite_code FROM groups WHERE invite_code IN (${placeholders})`)
    .bind(...candidates)
    .all<{ invite_code: string }>()
  const existingSet = new Set(existing.results.map((r) => r.invite_code))
  return candidates.find((c) => !existingSet.has(c)) ?? null
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

/**
 * Sorteia um código livre e grava com `write`. Outra criação ou troca pode gravar
 * o mesmo código entre a consulta e a escrita: o UNIQUE de invite_code barra a
 * duplicata e o sorteio se repete, até 3 vezes. Devolve o código gravado, ou
 * null quando as tentativas acabam.
 */
async function writeWithUniqueInviteCode(
  db: D1Database,
  write: (inviteCode: string) => Promise<unknown>,
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inviteCode = await pickUniqueInviteCode(db)
    if (!inviteCode) continue
    try {
      await write(inviteCode)
    } catch (error) {
      if (isUniqueViolation(error)) continue
      throw error
    }
    return inviteCode
  }
  return null
}

/**
 * Resolves `userId` / `groupId` / `db` from the request and checks that the
 * user belongs to the `:id` group. Shared by the read handlers that gate on
 * plain membership (`GET /:id`, `GET /:id/members`) so the "must be a member"
 * rule and its 404 shape live in one place.
 *
 * On success returns the resolved context plus the membership row; on failure
 * returns `{ error: c.json(...) }` with the uniform 404 the callers already
 * used — the caller does `if ('error' in gate) return gate.error`.
 */
async function requireGroupMembership(c: Context<AppContext, '/:id'>): Promise<
  | { error: Response }
  | {
      userId: string
      groupId: string
      db: D1Database
      membership: { role: string }
    }
> {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB

  const membership = await getGroupMembership(db, groupId, userId)
  if (!membership) {
    return { error: c.json({ error: 'Grupo não encontrado' }, 404) }
  }

  if (await isPilotGroupBlocked(c, db, groupId)) {
    return { error: c.json({ error: 'Grupo não encontrado' }, 404) }
  }

  return { userId, groupId, db, membership }
}

// Colunas de `groups` que as ações de dono leem. `findVisibleGroup` só aceita estas
// chaves, então a lista que vai para o SELECT nunca vem de entrada do usuário.
type VisibleGroupColumns = {
  owner_user_id: string
  competition_id: string
  points_classified: number
}

/**
 * Lê as `columns` do grupo `:id` que existe, não foi excluído e não está fechado
 * por piloto para o usuário. Grupo fora disso vira o 404 de sempre. A checagem de
 * dono fica no handler, porque cada ação responde um 403 próprio.
 *
 * Mesmo formato de `requireGroupMembership`: `if ('error' in found) return found.error`.
 */
async function findVisibleGroup<K extends keyof VisibleGroupColumns>(
  c: Context<AppContext>,
  db: D1Database,
  groupId: string,
  columns: readonly K[],
): Promise<{ group: Pick<VisibleGroupColumns, K> } | { error: Response }> {
  const group = await db
    .prepare(`SELECT ${columns.join(', ')} FROM groups WHERE id = ? AND deleted_at IS NULL`)
    .bind(groupId)
    .first<Pick<VisibleGroupColumns, K>>()

  if (!group || (await isPilotGroupBlocked(c, db, groupId))) {
    return { error: c.json({ error: 'Grupo não encontrado' }, 404) }
  }
  return { group }
}

/**
 * Motivo pelo qual o usuário não pode entrar no grupo agora: banido (403) ou já
 * membro (409), nessa ordem. `null` quando nenhum dos dois se aplica.
 */
async function joinConflict(
  db: D1Database,
  groupId: string,
  userId: string,
): Promise<{ error: string; status: 403 | 409 } | null> {
  const banned = await db
    .prepare('SELECT user_id FROM group_bans WHERE group_id = ? AND user_id = ?')
    .bind(groupId, userId)
    .first()
  if (banned) return { error: 'Acesso revogado pelo administrador', status: 403 }
  const member = await db
    .prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, userId)
    .first()
  if (member) return { error: 'Você já é membro deste grupo', status: 409 }
  return null
}

async function fetchGroupsPodiums(
  db: D1Database,
  finishedGroupIds: string[],
  userId: string,
): Promise<Map<string, PodiumEntry[]>> {
  const podiumByGroup = new Map<string, PodiumEntry[]>()
  if (finishedGroupIds.length === 0) return podiumByGroup

  // Usa json_each em um único bind para não estourar o limite de 100 parâmetros do D1.
  const podiumRows = await db
    .prepare(
      `
      SELECT group_id, user_id, display, points, rank
      FROM (
        SELECT
          gm.group_id AS group_id,
          gm.user_id AS user_id,
          l.user_id AS scored_user_id,
          ${memberDisplaySql()} AS display,
          l.total_points AS points,
          ROW_NUMBER() OVER (
            PARTITION BY gm.group_id
            -- Mesma numeração do endpoint de membros, senão o card diverge do ranking.
            -- Quem não tem linha no leaderboard ocupa o lugar e não aparece.
            ORDER BY ${rankingOrderSql()}
          ) AS rank
        FROM group_members gm
        JOIN users u ON u.id = gm.user_id
        LEFT JOIN leaderboard l ON l.group_id = gm.group_id AND l.user_id = gm.user_id
        LEFT JOIN profiles p ON p.user_id = gm.user_id
        WHERE gm.group_id IN (SELECT value FROM json_each(?)) AND ${notBannedSql('gm')}
      )
      WHERE rank <= 3 AND scored_user_id IS NOT NULL
      ORDER BY group_id, rank
      `,
    )
    .bind(JSON.stringify(finishedGroupIds))
    .all<{
      group_id: string
      user_id: string
      display: string
      points: number
      rank: number
    }>()

  for (const row of podiumRows.results) {
    const entries = podiumByGroup.get(row.group_id) ?? []
    entries.push({
      position: row.rank,
      display: row.display,
      points: row.points,
      is_you: row.user_id === userId,
    })
    podiumByGroup.set(row.group_id, entries)
  }

  return podiumByGroup
}

/**
 * Campos do status da rodada no card do painel. Grupo encerrado sai sem
 * pendência, sem prazo e sem jogo ao vivo.
 */
function roundStatusFields(
  competitionStatus: GroupRow['competition_status'],
  summary: PendingSummary,
  deadlineMatches: Map<string, Omit<DeadlineMatch, 'start_time'>>,
  liveMatches: number,
) {
  if (competitionStatus === 'finished') {
    return {
      pending_predictions: 0,
      next_deadline: null,
      next_match_at: null,
      current_round_label: null,
      current_round_agreement: null,
      round_ends_at: null,
      live_matches: 0,
    }
  }
  const deadlineMatch = summary.deadline ? deadlineMatches.get(summary.deadline.match_id) : undefined
  const nextDeadline: DeadlineMatch | null =
    summary.deadline && deadlineMatch
      ? { ...deadlineMatch, start_time: summary.deadline.start_time }
      : null
  // Rodada desconhecida sai sem rótulo: o painel escreve "Tudo palpitado" em vez
  // do código cru do provedor.
  const agreement = summary.round ? roundAgreement(summary.round) : null
  return {
    pending_predictions: summary.pending,
    next_deadline: nextDeadline,
    next_match_at: summary.next_match_at,
    current_round_label: summary.round && agreement ? roundLabel(summary.round) : null,
    current_round_agreement: agreement,
    round_ends_at: summary.round_ends_at,
    live_matches: liveMatches,
  }
}

/**
 * Jogos ao vivo e jogo de prazo só completam o card. Se a consulta falhar, a
 * lista sai sem eles, com `live_matches` 0 e `next_deadline` nulo.
 */
function emptyOnError<T>(query: Promise<Map<string, T>>, what: string): Promise<Map<string, T>> {
  return query.catch((error: unknown) => {
    console.error('[groups] Error fetching %s:', what, error)
    return new Map<string, T>()
  })
}

/**
 * Resumo dos jogos abertos de cada grupo, com rodada e times do jogo de prazo
 * dos grupos em andamento, para a faixa "Próximo prazo" do painel.
 *
 * Palpite salvo em que falta o pênalti conta como pendente, como na aba
 * Palpitar. Ele pode virar o prazo, então entra antes da busca do jogo de prazo.
 * Se a conferência falhar, o resumo fica só com os jogos sem palpite.
 */
async function roundSummaries(
  db: D1Database,
  userId: string,
  groups: ReadonlyArray<
    Pick<GroupRow, 'id' | 'competition_id' | 'competition_status'> & {
      penalty_phases: string | null
      pending_summary: string | null
    }
  >,
) {
  const ongoing = groups.filter((group) => group.competition_status !== 'finished')
  const parsed = new Map(
    groups.map((group) => [group.id, parsePendingSummary(group.pending_summary)]),
  )
  const missingByGroup = await emptyOnError(
    missingPenalties(
      db,
      userId,
      ongoing.map((group) => ({
        id: group.id,
        competition_id: group.competition_id,
        penalty_phases: group.penalty_phases,
        candidates: parsed.get(group.id)!.penalty_candidates,
      })),
    ),
    'missing penalties',
  )
  const summaries = new Map<string, PendingSummary>()
  for (const [id, summary] of parsed) {
    summaries.set(id, withMissingPenalties(summary, missingByGroup.get(id) ?? []))
  }
  const deadlineMatchIds = ongoing.flatMap(
    (group) => summaries.get(group.id)?.deadline?.match_id ?? [],
  )
  const deadlineMatches = await emptyOnError(
    fetchDeadlineMatches(db, deadlineMatchIds),
    'deadline matches',
  )
  return { summaries, deadlineMatches }
}

router.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const startedAt = Date.now()
  const inviteCode = c.req.query('invite_code')?.trim().toUpperCase()

  const db = c.env.DB
  try {
    // A sessão pode mudar no mesmo navegador entre duas consultas.
    c.header('Cache-Control', 'private, no-store')

    const canSeePilot = hasPilotAccess(c.get('userIdentity'), c.env)

    const dbStartedAt = Date.now()
    const nowIso = new Date().toISOString()
    const [groups, liveByCompetition] = await Promise.all([
      db
        .prepare(groupsListSql(canSeePilot))
        .bind(...groupsListBinds(nowIso, userId))
        .all<
          GroupRow & {
            points_exact: number
            user_position: number | null
            user_points: number
            penalty_phases: string | null
            pending_summary: string | null
          }
        >(),
      emptyOnError(fetchLiveMatchesByCompetition(db, nowIso), 'live matches'),
    ])

    const matchedInviteGroup = inviteCode
      ? (groups.results.find((group) => group.invite_code === inviteCode) ?? null)
      : null

    // Pódio só para grupos encerrados: o card ativo mostra "como vou", o encerrado
    // mostra "quem ganhou". Buscamos os 3 primeiros de cada grupo finalizado numa
    // única query com ROW_NUMBER(), em vez de N subqueries no SELECT principal.
    const finishedGroupIds = groups.results
      .filter((group) => group.competition_status === 'finished')
      .map((group) => group.id)

    const [podiumByGroup, { summaries, deadlineMatches }] = await Promise.all([
      fetchGroupsPodiums(db, finishedGroupIds, userId),
      roundSummaries(db, userId, groups.results),
    ])

    const dbMs = Date.now() - dbStartedAt
    const payload = {
      groups: groups.results.map((group) => ({
        id: group.id,
        name: group.name,
        competition_id: group.competition_id,
        competition_name: group.competition_name ?? null,
        competition_type: group.competition_type ?? null,
        competition_code: group.competition_code ?? null,
        competition_status: group.competition_status ?? null,
        points_exact: group.points_exact,
        is_admin: group.admin_id === userId,
        created_at: group.created_at,
        member_count: group.member_count,
        user_position: group.user_position,
        user_points: group.user_points,
        ...roundStatusFields(
          group.competition_status,
          summaries.get(group.id)!,
          deadlineMatches,
          liveByCompetition.get(group.competition_id) ?? 0,
        ),
        podium: podiumByGroup.get(group.id) ?? null,
      })),
      matched_invite_group_id: matchedInviteGroup?.id ?? null,
    }

    logRequestPerf(c.env.AE, 'GET /groups', {
      status: 200,
      totalMs: Date.now() - startedAt,
      dbMs,
      rows: payload.groups.length,
    })

    return c.json(payload)
  } catch (error) {
    console.error('[groups] Error fetching groups for user %s:', userId, error)
    return c.json({ error: 'Erro ao carregar grupos' }, 500)
  }
})

/**
 * POST /groups
 *
 * Creates a new group. The authenticated user becomes the owner.
 *
 * Body: { name: string, competition_id: string }
 *
 * Response 201:
 * { group: { id, name, competition_id, invite_code } }
 *
 * Response 409: o usuário já está no teto de grupos criados ou de participações
 * (`groupCaps.ts`).
 */
router.post(
  '/',
  requireAuth,
  async (c, next) => {
    if (!hasFeatureAccess(c.get('userEmail'), 'create_group')) {
      return c.json({ error: 'Você não tem permissão para criar grupos' }, 403)
    }
    return next()
  },
  validateJson(createGroupSchema, mapCreateGroupError),
  async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const competition_id = body.competition_id

  const parsedName = parseGroupName(body.name)
  if ('error' in parsedName) return c.json({ error: parsedName.error }, 400)
  const { name } = parsedName

  // Scoring rules & visibility — set at creation, immutable afterwards.
  const points_exact = body.points_exact ?? 3
  const points_winner = body.points_winner ?? 1
  // Penalty-shootout bonus — additive and independent of the exact>=winner rule.
  const points_penalty = body.points_penalty ?? 1
  const points_classified = body.points_classified ?? 0
  const predictions_visibility = body.predictions_visibility ?? 'hidden'

  // points_exact === 0 enables the "só vencedor" (1X2) mode and is always allowed.
  // Otherwise an exact hit must be worth at least as much as a plain winner hit.
  if (points_exact > 0 && points_exact < points_winner) {
    return c.json(
      {
        error: 'Pontos por placar exato deve ser maior ou igual a pontos por vencedor',
      },
      400,
    )
  }
  if (points_exact + points_winner === 0) {
    return c.json({ error: 'Pelo menos um tipo de pontuação deve ser maior que zero' }, 400)
  }

  const db = c.env.DB

  // Valida que a competição existe e que o usuário tem acesso caso esteja em piloto
  const competition = await db
    .prepare('SELECT id, visibility FROM competitions WHERE id = ?')
    .bind(competition_id)
    .first<{ id: string; visibility?: string | null }>()

  if (
    !competition ||
    (competition.visibility === 'pilot' && !hasPilotAccess(c.get('userIdentity'), c.env))
  ) {
    return c.json({ error: 'Competição não encontrada' }, 404)
  }

  const groupId = crypto.randomUUID()
  const memberId = crypto.randomUUID()
  const public_id = generatePublicId()

  try {
    // Os tetos por usuário são conferidos no próprio INSERT do grupo. Um SELECT COUNT
    // separado deixaria duas criações simultâneas passarem do teto. O dono vira
    // participante, então a criação também respeita o teto de participações. Com o
    // grupo recusado, o INSERT do dono não encontra o grupo e não grava nada.
    let created = false
    const invite_code = await writeWithUniqueInviteCode(db, async (inviteCode) => {
      const [group] = await db.batch([
        db
          .prepare(
            `INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, public_id, points_exact, points_winner, points_penalty, points_classified, predictions_visibility)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE ${ACTIVE_GROUPS_OWNED_COUNT_SQL} < ?
                AND ${ACTIVE_MEMBERSHIPS_COUNT_SQL} < ?`,
          )
          .bind(
            groupId,
            name,
            competition_id,
            userId,
            inviteCode,
            public_id,
            points_exact,
            points_winner,
            points_penalty,
            points_classified,
            predictions_visibility,
            userId,
            MAX_ACTIVE_GROUPS_OWNED,
            userId,
            MAX_ACTIVE_MEMBERSHIPS,
          ),
        db
          .prepare(
            `INSERT INTO group_members (id, group_id, user_id, role)
             SELECT ?, ?, ?, 'owner'
              WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?)`,
          )
          .bind(memberId, groupId, userId, groupId),
      ])
      created = group.meta.changes > 0
    })
    if (!invite_code) return c.json({ error: 'Erro interno ao gerar convite' }, 503)
    if (!created) {
      // Só para escolher a mensagem. A recusa já aconteceu no INSERT.
      const owned = await db
        .prepare(`SELECT ${ACTIVE_GROUPS_OWNED_COUNT_SQL} AS n`)
        .bind(userId)
        .first<{ n: number }>()
      const ownedCapReached = (owned?.n ?? 0) >= MAX_ACTIVE_GROUPS_OWNED
      return c.json({ error: ownedCapReached ? OWNED_CAP_ERROR : CREATE_MEMBERSHIP_CAP_ERROR }, 409)
    }

    logEvent(c.env.AE, 'group_created', {
      blobs: [groupId, competition_id, await hashUserId(userId), predictions_visibility],
      doubles: [points_exact, points_winner, points_penalty],
    })

    return c.json({ group: { id: groupId, name, competition_id, invite_code, public_id } }, 201)
  } catch (error) {
    console.error('[groups] Error creating group for user %s:', userId, error)
    return c.json({ error: 'Erro ao criar grupo' }, 500)
  }
})

/**
 * POST /groups/join
 *
 * Joins an existing group via invite code.
 *
 * Body: { invite_code: string, entry_method?: 'convite_link' | 'codigo' }
 * `entry_method` só alimenta o funil do Analytics Engine. Não muda a entrada.
 *
 * Response 200:
 * { group: { id, name } }
 *
 * Response 409: já é membro, grupo lotado ou usuário no teto de participações
 * (`groupCaps.ts`).
 */
router.post(
  '/join',
  requireAuth,
  validateJson(joinGroupSchema, mapJoinGroupError),
  async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const invite_code = body.invite_code.toUpperCase()

  const db = c.env.DB

  const group = await db
    .prepare(
      `SELECT g.id, g.name, g.max_members, c.visibility AS competition_visibility
       FROM groups g
       LEFT JOIN competitions c ON g.competition_id = c.id
       WHERE g.invite_code = ? AND g.deleted_at IS NULL`,
    )
    .bind(invite_code)
    .first<{
      id: string
      name: string
      max_members: number
      competition_visibility?: string | null
    }>()

  if (
    !group ||
    (group.competition_visibility === 'pilot' && !hasPilotAccess(c.get('userIdentity'), c.env))
  ) {
    return c.json({ error: 'Código de convite inválido' }, 404)
  }

  const conflict = await joinConflict(db, group.id, userId)
  if (conflict) return c.json({ error: conflict.error }, conflict.status)

  // Limite, banimento, convite atual e teto de participações no mesmo INSERT
  // (ver tryInsertGroupMember). Aprovação de pedido reutiliza o mesmo caminho.
  const inserted = await tryInsertGroupMember(db, group, userId, invite_code)
  if (!inserted.ok) {
    return c.json({ error: inserted.error }, inserted.status)
  }

  logEvent(c.env.AE, 'group_joined', {
    blobs: [
      group.id,
      await hashUserId(userId),
      parseClientEntryMethod(body.entry_method),
      await readRecentSignupFlag(db, inserted.memberId),
    ],
  })

  return c.json({ group: { id: group.id, name: group.name } })
})

// Pedidos pelo link público: /join-requests antes de /:id para o segmento
// estático não ser lido como id de grupo.
registerJoinRequestRoutes(router)

/**
 * GET /groups/:id
 *
 * Returns detail for a single group the authenticated user belongs to.
 * The invite_code is included — visible only to the owner in the UI.
 *
 * Response:
 * { group: { id, name, competition_id, competition_name, competition_status, is_admin, invite_code, created_at, member_count, user_position, user_points } }
 */
router.get('/:id', requireAuth, async (c) => {
  const gate = await requireGroupMembership(c)
  if ('error' in gate) return gate.error
  const { userId, groupId, db } = gate

  const group = await db
    .prepare(
      `SELECT
         g.id,
         g.name,
         g.competition_id,
         c.name AS competition_name,
         c.type AS competition_type,
         c.external_id AS competition_code,
         ${competitionStatusSql('g', 'c')} AS competition_status,
         g.owner_user_id AS admin_id,
         g.invite_code,
         g.public_id,
         g.join_requests_enabled,
         g.created_at,
         g.points_exact,
         g.points_winner,
         g.points_penalty,
         g.points_classified,
         g.predictions_visibility,
         COUNT(DISTINCT gm.user_id) AS member_count,
         COALESCE(l.total_points, 0) AS user_points,
         COALESCE(l.exact_hits, 0) AS exact_hits,
         ${userPositionSql('g.id', '?')} AS user_position,
         (SELECT COUNT(*) FROM group_join_requests r
           WHERE r.group_id = g.id AND r.status = 'pending') AS pending_join_request_count
       FROM groups g
       INNER JOIN group_members gm ON g.id = gm.group_id AND ${notBannedSql('gm')}
       LEFT JOIN competitions c ON g.competition_id = c.id
       LEFT JOIN leaderboard l ON g.id = l.group_id AND l.user_id = ?
       WHERE g.id = ? AND g.deleted_at IS NULL
       GROUP BY g.id`,
    )
    .bind(userId, userId, groupId)
    .first<
      GroupRow & {
        public_id: string | null
        join_requests_enabled: number
        points_exact: number
        points_winner: number
        points_penalty: number
        points_classified: number
        predictions_visibility: string
        user_points: number
        exact_hits: number
        user_position: number | null
        pending_join_request_count: number
      }
    >()

  if (!group) {
    return c.json({ error: 'Grupo não encontrado' }, 404)
  }

  const isAdmin = group.admin_id === userId

  return c.json({
    group: {
      id: group.id,
      name: group.name,
      competition_id: group.competition_id,
      competition_name: group.competition_name,
      competition_type: group.competition_type ?? null,
      competition_code: group.competition_code ?? null,
      competition_status: group.competition_status ?? null,
      is_admin: isAdmin,
      invite_code: isAdmin ? group.invite_code : null,
      public_id: group.public_id,
      join_requests_enabled: Boolean(group.join_requests_enabled),
      pending_join_request_count: isAdmin ? Number(group.pending_join_request_count) || 0 : 0,
      created_at: group.created_at,
      points_exact: group.points_exact,
      points_winner: group.points_winner,
      points_penalty: group.points_penalty,
      points_classified: group.points_classified,
      predictions_visibility: group.predictions_visibility,
      member_count: group.member_count,
      user_points: group.user_points,
      exact_hits: group.exact_hits,
      user_position: group.user_position,
    },
  })
})

/**
 * PATCH /groups/:id
 *
 * Updates a group name or classified bonus. Only the owner may do this.
 * Existing scored predictions and rankings are recalculated when the bonus changes.
 *
 * Body: { name?: string, points_classified?: number, join_requests_enabled?: boolean }
 * Response 200: { group: { id, name?, points_classified?, join_requests_enabled? } }
 */
router.patch(
  '/:id',
  requireAuth,
  validateJson(patchGroupSchema, mapPatchGroupError),
  async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB
  const body = c.req.valid('json')
  const pointsClassified = body.points_classified

  const parsedName = body.name === undefined ? undefined : parseGroupName(body.name)
  if (parsedName && 'error' in parsedName) return c.json({ error: parsedName.error }, 400)
  const name = parsedName?.name

  const found = await findVisibleGroup(c, db, groupId, [
    'owner_user_id',
    'competition_id',
    'points_classified',
  ])
  if ('error' in found) return found.error
  const { group } = found

  if (group.owner_user_id !== userId) {
    return c.json({ error: 'Apenas o administrador pode editar o grupo' }, 403)
  }

  const updates: string[] = []
  const values: (string | number)[] = []
  if (name !== undefined) {
    updates.push('name = ?')
    values.push(name)
  }
  if (pointsClassified !== undefined) {
    updates.push('points_classified = ?')
    values.push(pointsClassified)
  }
  if (body.join_requests_enabled !== undefined) {
    updates.push('join_requests_enabled = ?')
    values.push(body.join_requests_enabled ? 1 : 0)
  }
  const updateGroup = db
    .prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values, groupId)
  if (pointsClassified !== undefined) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [snapshotGuard, ...scoringUpdates] = await classifiedRuleChangeStatements(
        db,
        groupId,
        group.competition_id,
        pointsClassified,
      )
      try {
        await db.batch([snapshotGuard!, updateGroup, ...scoringUpdates])
        break
      } catch (error) {
        const detail = String(error) + String(error instanceof Error ? error.cause : '')
        if (!detail.includes('classified_snapshot_changed')) throw error
        if (attempt === 2)
          return c.json({ error: 'Os resultados mudaram durante a edição. Tente novamente.' }, 409)
      }
    }
  } else {
    await updateGroup.run()
  }

  // Só registra rename quando o nome (ou a pontuação, que recalcula) mudou.
  // Ligar/desligar pedidos pelo link não é rename.
  if (name !== undefined || pointsClassified !== undefined) {
    logEvent(c.env.AE, 'group_renamed', {
      blobs: [groupId, await hashUserId(userId)],
    })
  }

  return c.json({
    group: {
      id: groupId,
      ...(name !== undefined ? { name } : {}),
      ...(pointsClassified !== undefined ? { points_classified: pointsClassified } : {}),
      ...(body.join_requests_enabled !== undefined
        ? { join_requests_enabled: body.join_requests_enabled }
        : {}),
    },
  })
})

/**
 * POST /groups/:id/invite/rotate
 *
 * Gera um novo código de convite e invalida o anterior. Só o dono do grupo.
 * Quem já é membro continua no grupo; o código antigo deixa de permitir entradas.
 *
 * Response: { invite_code }
 */
router.post('/:id/invite/rotate', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB

  const found = await findVisibleGroup(c, db, groupId, ['owner_user_id'])
  if ('error' in found) return found.error
  const { group } = found

  if (group.owner_user_id !== userId) {
    return c.json({ error: 'Apenas o administrador pode trocar o convite' }, 403)
  }

  const inviteCode = await writeWithUniqueInviteCode(db, (code) =>
    db
      .prepare('UPDATE groups SET invite_code = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(code, groupId)
      .run(),
  )
  if (!inviteCode) return c.json({ error: 'Erro interno ao gerar convite' }, 503)

  logEvent(c.env.AE, 'group_invite_rotated', {
    blobs: [groupId, await hashUserId(userId)],
  })

  return c.json({ invite_code: inviteCode })
})

/**
 * DELETE /groups/:id
 *
 * Soft-deletes a group (sets deleted_at). Only the owner (admin) may do this.
 * The group is hidden from listings and detail views; its data is retained.
 */
router.delete('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const db = c.env.DB

  const found = await findVisibleGroup(c, db, groupId, ['owner_user_id', 'competition_id'])
  if ('error' in found) return found.error
  const { group } = found

  if (group.owner_user_id !== userId) {
    return c.json({ error: 'Apenas o administrador pode excluir o grupo' }, 403)
  }

  await db
    .prepare(`UPDATE groups SET deleted_at = datetime('now') WHERE id = ?`)
    .bind(groupId)
    .run()

  logEvent(c.env.AE, 'group_deleted', {
    blobs: [groupId, await hashUserId(userId), group.competition_id],
  })

  return c.json({ success: true })
})

/**
 * GET /groups/:id/members
 *
 * Returns the ranked member list for a group.
 * Any member of the group can view this.
 *
 * Response:
 * { members: [{ user_id, display_name, avatar_url, role, joined_at, total_points, exact_hits }] }
 */
router.get('/:id/members', requireAuth, async (c) => {
  const gate = await requireGroupMembership(c)
  if ('error' in gate) return gate.error
  const { groupId, db } = gate

  const members = await db
    .prepare(
      `SELECT
         gm.user_id,
         gm.role,
         gm.joined_at,
         ${memberDisplaySql()} AS display_name,
         p.avatar_url,
         COALESCE(l.total_points, 0) AS total_points,
         COALESCE(l.exact_hits, 0) AS exact_hits
       FROM group_members gm
       INNER JOIN users u ON gm.user_id = u.id
       LEFT JOIN profiles p ON gm.user_id = p.user_id
       LEFT JOIN leaderboard l ON gm.group_id = l.group_id AND gm.user_id = l.user_id
       WHERE gm.group_id = ? AND ${notBannedSql('gm')}
       ORDER BY ${rankingOrderSql()}`,
    )
    .bind(groupId)
    .all<{
      user_id: string
      role: string
      joined_at: string
      display_name: string
      avatar_url: string | null
      total_points: number
      exact_hits: number
    }>()

  return c.json({ members: members.results })
})

/**
 * GET /groups/:id/round-standings
 *
 * Pontos de cada membro na última rodada encerrada, a variação de posição e a sequência
 * de rodadas com todos os jogos palpitados (ADR-021).
 * Mesmo acesso de GET /groups/:id/members.
 *
 * Response:
 * { round: "34", standings: [{ user_id, round_points, position_change, streak }] }
 * Sem rodada de referência: { round: null, standings: [] }
 */
router.get('/:id/round-standings', requireAuth, async (c) => {
  const gate = await requireGroupMembership(c)
  if ('error' in gate) return gate.error
  return c.json(await getRoundStandings(gate.db, gate.groupId))
})

/**
 * DELETE /groups/:id/members/:memberId
 *
 * Removes a member from the group.
 * The group admin (owner) can remove other members.
 * A non-owner member can remove themselves from the group.
 * The owner cannot remove themselves.
 */
router.delete('/:id/members/:memberId', requireAuth, async (c) => {
  const userId = c.get('userId')
  const groupId = c.req.param('id')
  const targetUserId = c.req.param('memberId')
  const db = c.env.DB

  const found = await findVisibleGroup(c, db, groupId, ['owner_user_id'])
  if ('error' in found) return found.error
  const { group } = found

  if (targetUserId === userId) {
    if (group.owner_user_id === userId) {
      return c.json({ error: 'Você não pode remover a si mesmo do grupo' }, 400)
    }
  } else if (group.owner_user_id !== userId) {
    return c.json({ error: 'Apenas o administrador pode remover membros' }, 403)
  }

  const membership = await db
    .prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, targetUserId)
    .first<{ id: string }>()

  if (!membership) {
    return c.json({ error: 'Membro não encontrado no grupo' }, 404)
  }

  // A linha do `leaderboard` fica: as leituras do ranking partem de `group_members`,
  // e quem volta ao grupo recupera os pontos que tinha.
  const removal = db
    .prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, targetUserId)
  if (targetUserId !== userId) {
    await db.batch([
      db
        .prepare('INSERT OR IGNORE INTO group_bans (group_id, user_id) VALUES (?, ?)')
        .bind(groupId, targetUserId),
      removal,
    ])
  } else {
    await removal.run()
  }

  logEvent(c.env.AE, 'member_removed', {
    // 'self' = saiu sozinho; 'admin' = removido pelo dono do grupo.
    blobs: [groupId, await hashUserId(targetUserId), targetUserId === userId ? 'self' : 'admin'],
  })

  return c.json({ success: true })
})

export { router as groupsRouter }
