/**
 * Link de convite de grupo.
 *
 * O formato atual é `/convite/<CODE>`: a Pages Function em
 * `functions/convite/[code].ts` responde essa rota com as meta tags Open Graph
 * do grupo (nome, campeonato, participantes), e é isso que o WhatsApp mostra no
 * preview. Na SPA, o visitante vê a página de convite nessa mesma URL e quem tem
 * sessão vai para `/?convite=<CODE>`, o fluxo de entrada do Dashboard. Links
 * antigos com `?convite=` seguem valendo.
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

// Alfabeto de `generateInviteCode` na API (sem I, O, 0 e 1). Global para achar
// todas as ocorrências e ficar com a última.
const INVITE_CODE_IN_TEXT_RE = /[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/gi

/**
 * Extrai o código de convite do que o usuário colou: o código puro, o link novo
 * (`/convite/CODE`), o antigo (`?convite=CODE`) ou um texto com o código no
 * meio, como a mensagem inteira do WhatsApp ou um link sem `https://`. No texto
 * vale a última ocorrência, que é onde o link fica na mensagem. Sempre em
 * maiúsculas.
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
    // Não é URL: segue para a busca no texto.
  }
  const found = value.match(INVITE_CODE_IN_TEXT_RE)
  if (found) return found[found.length - 1].toUpperCase()
  return value.toUpperCase()
}

// Mesmo formato validado pela API (api/src/public/router.ts).
const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

/** Código em maiúsculas, ou null quando o valor não tem o formato de um convite. */
export function normalizeInviteCode(raw: string | null | undefined): string | null {
  const value = raw?.trim().toUpperCase() ?? ''
  return INVITE_CODE_RE.test(value) ? value : null
}

// Chave duplicada no script inline do index.html, que descarta a landing na
// volta do Google. Se mudar aqui, mude lá também.
const ACCEPTED_INVITE_KEY = 'palpitae:convite-aceito'

/**
 * Registra, nesta aba, que a pessoa tocou em "Entrar com Google e participar".
 * A marca fica no sessionStorage porque um link de terceiros não consegue
 * escrever nele, então abrir `/?convite=CODE` nunca coloca ninguém num grupo
 * sem confirmação.
 */
export function markInviteAccepted(code: string): void {
  try {
    sessionStorage.setItem(ACCEPTED_INVITE_KEY, code)
  } catch {
    // Sem sessionStorage, a volta do login abre o modal de confirmação.
  }
}

/** Lê e apaga a marca. True só quando ela é deste código. */
export function consumeAcceptedInvite(code: string): boolean {
  try {
    const accepted = sessionStorage.getItem(ACCEPTED_INVITE_KEY)
    sessionStorage.removeItem(ACCEPTED_INVITE_KEY)
    return accepted === code
  } catch {
    return false
  }
}

const INVITE_DOCUMENT_KEY = 'palpitae:convite-aberto'

/**
 * Anota o convite quando este documento foi servido por `/convite/<código>`, a rota
 * que conta aberturas no servidor. Link antigo com `?convite=` e navegação dentro do
 * app não passam por ela. Chamar uma vez, ao carregar a página.
 */
export function rememberInviteDocument(pathname: string): void {
  if (!pathname.startsWith(INVITE_PATH_PREFIX)) return
  const code = normalizeInviteCode(pathname.slice(INVITE_PATH_PREFIX.length).replace(/\/$/, ''))
  if (!code) return
  try {
    sessionStorage.setItem(INVITE_DOCUMENT_KEY, code)
  } catch {
    // Sem sessionStorage, a entrada conta como link antigo e fica fora da taxa.
  }
}

/** True quando este código chegou por um documento de `/convite/<código>` nesta aba. */
export function wasInviteDocumentOpened(code: string): boolean {
  try {
    return sessionStorage.getItem(INVITE_DOCUMENT_KEY) === code
  } catch {
    return false
  }
}
