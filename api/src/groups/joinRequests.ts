/**
 * Pedidos de entrada pelo link público do grupo.
 *
 * O link usa `groups.public_id` (32 hex), distinto do `invite_code`. Trocar o
 * convite não invalida o link. O dono desliga novos pedidos com
 * `join_requests_enabled`. Limites e cooldown ficam aqui para a API e os testes
 * usarem a mesma constante.
 */

/** Pedidos que um usuário pode criar por dia UTC (todos os grupos). */
export const JOIN_REQUESTS_PER_USER_PER_DAY = 10

/** Dias após uma recusa em que o mesmo usuário não pode pedir de novo no grupo. */
export const JOIN_REQUEST_REJECT_COOLDOWN_DAYS = 7

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
export const JOIN_REQUEST_COOLDOWN = `Aguarde ${JOIN_REQUEST_REJECT_COOLDOWN_DAYS} dias após a recusa para pedir de novo`
export const JOIN_REQUEST_DAILY_LIMIT = 'Você atingiu o limite diário de pedidos de entrada'
export const JOIN_REQUEST_GROUP_FULL = 'Este grupo atingiu o limite de membros'
export const JOIN_REQUEST_ALREADY_MEMBER = 'Você já é membro deste grupo'
export const JOIN_REQUESTS_DISABLED = 'Este grupo não está aceitando pedidos pelo link'
