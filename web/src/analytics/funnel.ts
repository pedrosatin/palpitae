/**
 * Eventos de sucesso do funil de aquisição (GA4).
 *
 * Os `click_*` dizem que o usuário tentou; estes dizem que a ação terminou:
 * login concluído, convite compartilhado, entrada no grupo. Os nomes `login` e
 * `join_group` são eventos recomendados do GA4, então aparecem nos relatórios
 * padrão sem configuração extra. Ver docs/analytics.md.
 */
import { trackEvent } from './ga'

export type ShareInviteMethod = 'whatsapp' | 'twitter' | 'copy_link' | 'copy_code' | 'native'

/**
 * Convite compartilhado. `context` é o mesmo prefixo dos cliques
 * (`create_group` no modal de sucesso, `group_detail` na página do grupo).
 */
export function trackShareInvite(method: ShareInviteMethod, context: string): void {
  trackEvent('share_invite', { method, context })
}

export type JoinGroupSource = 'convite_link' | 'codigo'

/** Entrada no grupo confirmada pela API. */
export function trackJoinGroup(source: JoinGroupSource, groupId: string): void {
  trackEvent('join_group', { source, group_id: groupId })
}

// O OAuth sai do app (Google → API → volta para o front) e o retorno não traz
// nenhum sinal de "acabou de logar". O clique no botão marca a aba; quando o
// /auth/me responde, o App consome a marca e, se a sessão existir, conta o login.
// sessionStorage porque a marca só faz sentido nesta aba e nesta ida ao Google.
const LOGIN_PENDING_KEY = 'palpitae:login-pendente'

/** Chamado no clique de "Entrar com Google", antes de sair para o OAuth. */
export function markLoginStarted(): void {
  try {
    sessionStorage.setItem(LOGIN_PENDING_KEY, 'google')
  } catch {
    // Sem sessionStorage, o login segue normal e o evento `login` não é enviado.
  }
}

/**
 * Chamado quando o estado de auth resolve. Dispara `login` uma única vez se a
 * aba veio de um clique em "Entrar com Google" e a sessão agora existe. A marca
 * é apagada nos dois casos, para um login que falhou não ser contado depois.
 */
export function trackLoginIfPending(authenticated: boolean): void {
  let method: string | null = null
  try {
    method = sessionStorage.getItem(LOGIN_PENDING_KEY)
    sessionStorage.removeItem(LOGIN_PENDING_KEY)
  } catch {
    return
  }
  if (authenticated && method) trackEvent('login', { method })
}
