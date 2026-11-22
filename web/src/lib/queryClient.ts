import { QueryClient } from '@tanstack/react-query'

/** Cliente da árvore do browser. Limpo na troca de sessão para não vazar dados entre contas. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Mesmo comportamento do fetchCachedJson: sem retry automático.
        retry: false,
      },
    },
  })
}

export const appQueryClient = createAppQueryClient()
