/**
 * Link de convite de grupo.
 *
 * O formato atual é `/convite/<CODE>`: a Pages Function em
 * `functions/convite/[code].ts` responde essa rota com as meta tags Open Graph
 * do grupo (nome, campeonato, participantes), e é isso que o WhatsApp mostra no
 * preview. Dentro da SPA a rota só repassa o código para `/?convite=<CODE>`,
 * o fluxo de entrada que já existia. Links antigos com `?convite=` seguem valendo.
 */

/** Caminho da rota de convite, sem o código. */
export const INVITE_PATH_PREFIX = '/convite/'

/** Monta o link compartilhável do convite. */
export function buildInviteLink(
  inviteCode: string,
  origin: string = window.location.origin,
): string {
  return `${origin.replace(/\/+$/, '')}${INVITE_PATH_PREFIX}${encodeURIComponent(inviteCode)}`
}

/** Frase que acompanha o link no WhatsApp, no X e no menu nativo de compartilhar. */
export function buildInviteMessage(groupName?: string): string {
  const name = groupName?.trim()
  return name ? `Entra no meu bolão "${name}" no Palpitae:` : 'Entra no meu bolão no Palpitae:'
}

/**
 * Extrai o código de convite do que o usuário colou: o código puro, o link novo
 * (`/convite/CODE`) ou o antigo (`?convite=CODE`). Sempre em maiúsculas.
 */
export function parseInviteCode(raw: string): string {
  const value = raw.trim()
  try {
    const url = new URL(value)
    const param = url.searchParams.get('convite')
    if (param) return param.trim().toUpperCase()
    const match = url.pathname.match(/^\/convite\/([^/]+)\/?$/)
    if (match) return decodeURIComponent(match[1]).trim().toUpperCase()
  } catch {
    // Não é URL: segue como código.
  }
  return value.toUpperCase()
}
