import { QueryClient } from '@tanstack/react-query'

/** Defaults compartilhados entre o cliente da app e o dos testes. */
export const appQueryDefaults = {
  // A tela não busca de novo com o componente montado.
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  // Erro de rede aparece na tela mesmo com o navegador offline.
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
      mutations: {
        networkMode: 'always',
      },
    },
  })
}

export const appQueryClient = createAppQueryClient()
