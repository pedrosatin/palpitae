import { QueryClient } from '@tanstack/react-query'

/** Defaults de query compartilhados entre o cliente da app e o dos testes. */
export const appQueryDefaults = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  networkMode: 'always' as const,
}

/** Cliente da árvore do browser. O `App` limpa o cache na troca de sessão para não mostrar dados de outra conta. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...appQueryDefaults,
        retry: false,
      },
      mutations: { networkMode: appQueryDefaults.networkMode },
    },
  })
}

export const appQueryClient = createAppQueryClient()
