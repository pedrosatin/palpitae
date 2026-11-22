import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

/** Resultado de uma carga dos painéis admin. A função de carga nunca lança: falha vira `failed`. */
export type AdminLoad<T> = { kind: 'ok'; data: T } | { kind: 'forbidden' } | { kind: 'failed' }

type AdminLoadState<T> = {
  data: T | null
  error: 'forbidden' | 'failed' | null
  loading: boolean
}

export function adminQueryKey(scope: string, days: number) {
  return ['admin', scope, days] as const
}

/**
 * Carga dos painéis admin por período (métricas, radar).
 *
 * O período entra na chave da query: trocar o filtro cancela a busca anterior
 * via `signal` do queryFn. Dado, erro e carregamento mudam juntos.
 *
 * `load` precisa ter identidade estável (função de módulo) e aceitar o
 * `AbortSignal` da query.
 */
export function useAdminLoad<T>(
  scope: string,
  days: number,
  load: (days: number, signal: AbortSignal) => Promise<AdminLoad<T>>,
): AdminLoadState<T> & { retry: () => void } {
  const queryKey = adminQueryKey(scope, days)
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return await load(days, signal)
      } catch {
        return { kind: 'failed' } as AdminLoad<T>
      }
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

  const result = query.data
  const loading = query.isPending || query.isFetching
  const state: AdminLoadState<T> =
    loading || !result
      ? { data: null, error: null, loading: true }
      : result.kind === 'ok'
        ? { data: result.data, error: null, loading: false }
        : { data: null, error: result.kind, loading: false }

  const { refetch } = query
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])

  return { ...state, retry }
}
