import { QueryClient } from '@tanstack/react-query'

/** Defaults de query compartilhados entre o cliente da app e o dos testes. */
export const appQueryDefaults = {
  // Foco na janela e volta da rede não disparam nova busca, como no fetchCachedJson.
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  // Offline, a query roda e falha em vez de pausar, e o erro de rede aparece na tela.
  networkMode: 'always' as const,
}

/** Cliente da árvore do browser. O `App` limpa o cache na troca de sessão para não mostrar dados de outra conta. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...appQueryDefaults,
        // A primeira falha vai para a tela, sem nova tentativa automática.
        retry: false,
      },
      mutations: { networkMode: appQueryDefaults.networkMode },
    },
  })
}

export const appQueryClient = createAppQueryClient()
