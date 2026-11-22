import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { buildApiUrl } from '../../../config'
import { apiFetch } from '../../../lib/api'
import { applyDefaultRound } from '../../../lib/rounds'
import type { UserPrediction } from '../types'

type MemberPredictionsResponse = {
  predictions: UserPrediction[]
  default_round: string | null
}

export function memberPredictionsQueryKey(groupId: string, userId: string) {
  return ['predictions', 'user', groupId, userId] as const
}

function fetchMemberPredictions(
  groupId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<MemberPredictionsResponse> {
  return apiFetch(
    buildApiUrl('/predictions/user', new URLSearchParams({ group_id: groupId, user_id: userId })),
    { signal },
  ).then((r) => {
    if (!r.ok) throw new Error('Erro ao carregar palpites')
    return r.json() as Promise<MemberPredictionsResponse>
  })
}

export function useMemberPredictions(groupId: string, userId: string) {
  const query = useQuery({
    queryKey: memberPredictionsQueryKey(groupId, userId),
    queryFn: ({ signal }) => fetchMemberPredictions(groupId, userId, signal),
  })
  const [modalRoundIndex, setModalRoundIndex] = useState(0)
  const appliedDefaultRoundKey = useRef<string | null>(null)

  useEffect(() => {
    if (!query.data || query.isFetching) return
    const key = `${groupId}:${userId}`
    if (appliedDefaultRoundKey.current === key) return
    appliedDefaultRoundKey.current = key
    const keys = [...new Set(query.data.predictions.map((p) => p.round))]
    applyDefaultRound(query.data.default_round, keys, setModalRoundIndex)
  }, [groupId, userId, query.data, query.isFetching])

  return {
    modalPredictions: query.data?.predictions ?? [],
    modalLoading: query.isPending,
    modalError:
      !query.data && query.isError
        ? query.error instanceof Error
          ? query.error.message
          : 'Erro ao carregar palpites'
        : null,
    modalRoundIndex,
    setModalRoundIndex,
  }
}
