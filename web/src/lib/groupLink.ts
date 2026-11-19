/**
 * Link público do grupo para pedido de entrada.
 *
 * Distinto do convite (`/convite/<código>`): usa `public_id` e não dá entrada
 * automática. Qualquer membro pode compartilhar; o dono aprova na aba Membros.
 */

export const GROUP_LINK_PATH_PREFIX = '/grupo/'

/** Formato do identificador público (32 hex). */
const PUBLIC_ID_RE = /^[a-f0-9]{32}$/

export function normalizePublicId(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? ''
  return PUBLIC_ID_RE.test(value) ? value : null
}

/** Monta o link compartilhável do grupo. */
export function buildGroupLink(
  publicId: string,
  origin: string = window.location.origin,
): string {
  return `${origin.replace(/\/+$/, '')}${GROUP_LINK_PATH_PREFIX}${encodeURIComponent(publicId)}`
}

/** Mensagem que acompanha o link no WhatsApp / compartilhar. */
export function buildGroupLinkMessage(groupName?: string): string {
  const name = groupName?.trim()
  return name
    ? `Pede pra entrar no bolão "${name}" no Palpitae:`
    : 'Pede pra entrar no meu bolão no Palpitae:'
}
