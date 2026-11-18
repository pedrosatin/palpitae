/**
 * Pedidos de entrada pelo link público do grupo.
 *
 * O link usa `groups.public_id` (32 hex), distinto do `invite_code`. Trocar o
 * convite não invalida o link. O dono desliga novos pedidos com
 * `join_requests_enabled`. Limites e cooldown ficam aqui para a API e os testes
 * usarem a mesma constante.
 */
import { MAX_ACTIVE_MEMBERSHIPS } from './groupCaps'

/** Pedidos que um usuário pode criar por dia UTC (todos os grupos). */
export const JOIN_REQUESTS_PER_USER_PER_DAY = 10

/** Dias após uma recusa em que o mesmo usuário não pode pedir de novo no grupo. */
export const JOIN_REQUEST_REJECT_COOLDOWN_DAYS = 7

/**
 * Teto da listagem de pendentes para o dono. Evita resposta enorme se o grupo
 * acumular muitos pedidos; o limite de criação já corta em `max_members`.
 */
export const JOIN_REQUESTS_LIST_LIMIT = 100

/** Formato do identificador público: 32 hex minúsculos (UUID sem hífens). */
export const PUBLIC_ID_RE = /^[a-f0-9]{32}$/

export function normalizePublicId(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? ''
  return PUBLIC_ID_RE.test(value) ? value : null
}

/** Gera um identificador público de 32 hex. */
export function generatePublicId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected'

/** Mensagem genérica quando o pedido não pode seguir (banido, link off, etc.). */
export const JOIN_REQUEST_REFUSED = 'Não é possível pedir entrada neste grupo'

export const JOIN_REQUEST_ALREADY_PENDING = 'Você já pediu entrada neste grupo'
export const JOIN_REQUEST_COOLDOWN =
  `Seu pedido foi recusado. Você pode pedir de novo ${JOIN_REQUEST_REJECT_COOLDOWN_DAYS} dias depois da recusa.`
export const JOIN_REQUEST_DAILY_LIMIT =
  'Você atingiu o limite diário de pedidos de entrada. Tente de novo depois das 21h, horário de Brasília.'
export const JOIN_REQUEST_GROUP_FULL = 'Este grupo atingiu o limite de membros'
export const JOIN_REQUEST_ALREADY_MEMBER = 'Você já é membro deste grupo'
export const JOIN_REQUESTS_DISABLED = 'Este grupo não está aceitando pedidos pelo link'
export const JOIN_REQUEST_GROUP_PENDING_CAP =
  'Este grupo já tem pedidos pendentes demais. Tente de novo mais tarde.'

/** Mensagem ao dono quando a pessoa aprovada já está no teto de grupos. */
export const JOIN_REQUEST_APPROVE_MEMBERSHIP_CAP = `Essa pessoa já está no limite de ${MAX_ACTIVE_MEMBERSHIPS} grupos`

export const JOIN_REQUEST_OWNER_ONLY = 'Só o dono do grupo decide os pedidos'
