import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { buildApiUrl } from '../config'
import { apiFetch } from './api'
import { isRecord, UNEXPECTED_RESPONSE } from './responseShape'

export const GROUP_PREDICTIONS_STALE_TIME_MS = 30_000

export const groupPredictionsQueryPrefix = ['groups', 'predictions'] as const

export function groupPredictionsQueryKey(groupId: string) {
  return ['groups', 'predictions', groupId] as const
}

export function fetchGroupPredictions<T>(groupId: string): Promise<T> {
  return apiFetch(buildApiUrl('/predictions/group', new URLSearchParams({ group_id: groupId }))).then(
    (res) => {
      if (!res.ok) throw new Error('Erro ao carregar palpites do grupo')
      return res.json().then((body: unknown) => {
        if (!isRecord(body) || !Array.isArray(body.members) || !Array.isArray(body.predictions))
          throw new Error(UNEXPECTED_RESPONSE)
        return body as T
      })
    },
  )
}

export function groupPredictionsQueryOptions<T>(groupId: string) {
  return queryOptions({
    queryKey: groupPredictionsQueryKey(groupId),
    staleTime: GROUP_PREDICTIONS_STALE_TIME_MS,
    queryFn: () => fetchGroupPredictions<T>(groupId),
  })
}

export function invalidateGroupPredictions(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: groupPredictionsQueryPrefix,
    refetchType: 'none',
  })
}
