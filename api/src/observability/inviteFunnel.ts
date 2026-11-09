/**
 * Regras do funil de convite compartilhadas entre a entrada em grupo e o painel
 * de métricas. Ver "Funil de convite" em docs/observability.md.
 */

export const ENTRY_METHODS = ['convite_link', 'convite_antigo', 'codigo'] as const
export type EntryMethod = (typeof ENTRY_METHODS)[number]

/** Método de entrada aceito, ou '' quando o cliente não informou um valor conhecido. */
export function parseEntryMethod(raw: unknown): EntryMethod | '' {
  return ENTRY_METHODS.find((method) => method === raw) ?? ''
}

/**
 * Convidado novo: a conta nasceu menos de 1 h antes da entrada no grupo. Fica em
 * SQL, sobre `group_members gm` e `users u`, para a flag gravada no evento e a
 * contagem do D1 no painel serem a mesma conta sobre os mesmos valores.
 */
export const RECENT_SIGNUP_SQL = '(julianday(gm.joined_at) - julianday(u.created_at)) * 24 < 1'

/** `1` = conta com menos de 1 h, `0` = mais antiga, '' = não deu para saber. */
export type RecentSignupFlag = '1' | '0' | ''

/**
 * Flag de cadastro recente de um membro recém-inserido. A entrada no grupo já
 * aconteceu, então uma falha aqui deixa a flag vazia em vez de responder erro.
 */
export async function readRecentSignupFlag(
  db: D1Database,
  memberId: string,
): Promise<RecentSignupFlag> {
  try {
    const row = await db
      .prepare(
        `SELECT ${RECENT_SIGNUP_SQL} AS recent
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.id = ?`,
      )
      .bind(memberId)
      .first<{ recent: number | null }>()
    const recent = row?.recent ?? null
    if (recent === null) return ''
    return recent ? '1' : '0'
  } catch (error) {
    console.error('[groups] Falha ao ler o cadastro recente do membro:', error)
    return ''
  }
}

export interface InviteEventTotals {
  opens: number
  joins: number
  joinsByMethod: Record<EntryMethod | 'unknown', number>
  newMembers: number
  existingMembers: number
  /** Entradas sem a flag: anteriores à coleta ou com falha na leitura do D1. */
  unclassifiedJoins: number
}

type AeRow = Record<string, unknown>

function addJoin(totals: InviteEventTotals, row: AeRow, count: number): void {
  totals.joins += count
  totals.joinsByMethod[parseEntryMethod(row.method) || 'unknown'] += count
  if (row.recent_signup === '1') totals.newMembers += count
  else if (row.recent_signup === '0') totals.existingMembers += count
  else totals.unclassifiedJoins += count
}

/**
 * Soma as linhas da SQL API (`event_type`, `method`, `recent_signup`, `events`).
 * Método fora da lista vira `unknown`, então texto de blob nunca chega ao payload.
 */
export function summarizeInviteEvents(rows: AeRow[]): InviteEventTotals {
  const totals: InviteEventTotals = {
    opens: 0,
    joins: 0,
    joinsByMethod: { convite_link: 0, convite_antigo: 0, codigo: 0, unknown: 0 },
    newMembers: 0,
    existingMembers: 0,
    unclassifiedJoins: 0,
  }
  for (const row of rows) {
    const count = Number(row.events ?? 0)
    if (!Number.isFinite(count)) continue
    if (row.event_type === 'invite_opened') totals.opens += count
    else if (row.event_type === 'group_joined') addJoin(totals, row, count)
  }
  return totals
}

/**
 * Entradas por convite direto no D1, no mesmo período, para conferir o evento.
 * `role = 'member'` deixa de fora quem criou o grupo, que não gera `group_joined`.
 */
export async function countInviteJoinsInD1(
  db: D1Database,
  days: number,
): Promise<{ joins: number; newMembers: number; existingMembers: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS joins, COALESCE(SUM(${RECENT_SIGNUP_SQL}), 0) AS new_members
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.role = 'member' AND gm.joined_at > datetime('now', ?)`,
    )
    .bind(`-${days} days`)
    .first<{ joins: number; new_members: number }>()
  const joins = Number(row?.joins ?? 0)
  const newMembers = Number(row?.new_members ?? 0)
  return { joins, newMembers, existingMembers: joins - newMembers }
}
