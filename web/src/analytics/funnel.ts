/**
 * Eventos de sucesso do funil de aquisição (GA4).
 *
 * Os `click_*` dizem que o usuário tentou; estes dizem que a ação terminou:
 * login concluído, convite compartilhado, entrada no grupo. Os nomes `login` e
 * `join_group` são eventos recomendados do GA4, então aparecem nos relatórios
 * padrão sem configuração extra. Ver docs/analytics.md.
 *
 * A conversão do caminho por pedido fica no evento de servidor `group_joined`
 * com `entry_method=request`. No navegador do dono, a aprovação dispara
 * `approve_join_request` (sem dado pessoal). Quem pede dispara `join_request`.
 */
import { trackEvent } from './ga'
import { getGuideOrigin } from './guideOrigin'

export type ShareInviteMethod = 'whatsapp' | 'twitter' | 'copy_link' | 'copy_code' | 'native'

/**
 * Convite compartilhado. `context` é o mesmo prefixo dos cliques
 * (`create_group` no modal de sucesso, `group_detail` na página do grupo).
 */
export function trackShareInvite(method: ShareInviteMethod, context: string): void {
  trackEvent('share_invite', { method, context })
}

/** Métodos que o cliente envia em `join_group` / `POST /groups/join`. Sem `request`. */
export type JoinGroupEntryMethod = 'convite_link' | 'convite_antigo' | 'codigo'

/** Entrada no grupo confirmada pela API (caminho por convite/código). */
export function trackJoinGroup(entryMethod: JoinGroupEntryMethod): void {
  // Não usar `source`: o GA4 trata esse parâmetro como origem da sessão.
  trackEvent('join_group', { entry_method: entryMethod })
}

/** Pedido de entrada enviado pelo link público do grupo. */
export function trackJoinRequest(): void {
  trackEvent('join_request')
}

/**
 * Dono aprovou um pedido na aba Membros. Sem dado pessoal; a conversão do
 * caminho por pedido é o `group_joined` do servidor com `entry_method=request`.
 */
export function trackApproveJoinRequest(): void {
  trackEvent('approve_join_request')
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
  if (authenticated && method) {
    const origem = getGuideOrigin()
    trackEvent('login', { method, ...(origem ? { origem } : {}) })
  }
}
