/**
 * Destino de quem já tem sessão e abre `/entrar`.
 *
 * Quem entra pelo Google sai de `/entrar?from=…&competicao=…` por
 * `window.location.href`, e essa entrada fica no histórico. Ao voltar até ela
 * depois do login, o `competicao` reabriria o formulário de criação que a
 * pessoa já fechou. Por isso a carga vinda do histórico perde só esse
 * parâmetro. Uma carga nova, como um segundo clique no guia, mantém tudo.
 */
export function loggedInLoginTarget(search: string, fromHistory: boolean): string {
  if (!fromHistory) return `/${search}`
  const params = new URLSearchParams(search)
  params.delete('competicao')
  const rest = params.toString()
  return rest ? `/?${rest}` : '/'
}

/**
 * Diz se o documento atual foi carregado por voltar ou avançar no histórico.
 * Sem a Navigation Timing API, responde que não, e o redirect mantém a query.
 */
export function pageLoadedFromHistory(
  perf: Partial<Performance> | undefined = globalThis.performance,
): boolean {
  try {
    if (typeof perf?.getEntriesByType !== 'function') return false
    const [entry] = perf.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    return entry?.type === 'back_forward'
  } catch {
    return false
  }
}
