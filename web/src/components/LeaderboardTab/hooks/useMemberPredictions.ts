import { useEffect, useState } from 'react'
import { config } from '../../../config'
import { apiFetch } from '../../../lib/api'
import { applyDefaultRound } from '../../../lib/rounds'
import type { UserPrediction } from '../types'

export function useMemberPredictions(groupId: string, userId: string) {
  const [modalPredictions, setModalPredictions] = useState<UserPrediction[]>([])
  const [modalLoading, setModalLoading] = useState(true)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalRoundIndex, setModalRoundIndex] = useState(0)

  useEffect(() => {
    let mounted = true
    setModalLoading(true)
    setModalError(null)

    apiFetch(
      `${config.apiUrl}/predictions/user?group_id=${encodeURIComponent(groupId)}&user_id=${encodeURIComponent(userId)}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar palpites')
        return r.json() as Promise<{
          predictions: UserPrediction[]
          default_round: string | null
        }>
      })
      .then((data) => {
        if (!mounted) return
        setModalPredictions(data.predictions)
        const keys = [...new Set(data.predictions.map((p) => p.round))]
        applyDefaultRound(data.default_round, keys, setModalRoundIndex)
      })
      .catch((e: Error) => {
        if (!mounted) return
        setModalError(e.message)
      })
      .finally(() => {
        if (!mounted) return
        setModalLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [groupId, userId])

  return {
    modalPredictions,
    modalLoading,
    modalError,
    modalRoundIndex,
    setModalRoundIndex,
  }
}
