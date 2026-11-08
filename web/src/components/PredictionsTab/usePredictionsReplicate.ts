import { useCallback, useEffect, useRef, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { invalidateApiCache } from '../../lib/api-cache'
import { readReplicatePreference, writeReplicatePreference } from '../../lib/replicatePreference'
import {
  describeReplicate,
  MAX_REPLICATE_TARGETS,
  postReplicate,
} from '../../lib/replicateToGroups'

type TargetGroup = {
  id: string
  name: string
  competition_status?: string | null
  points_exact?: number
}
export type ReplicateFeedback = {
  id: number
  ok: boolean
  message: string
  /** Jogos do envio que falhou, para tentar de novo. */
  matchIds?: string[]
}

/** Confirmações que ficam na barra ao mesmo tempo. As mais antigas saem primeiro. */
const MAX_FEEDBACK = 3

type Scope = {
  groupId: string
  competitionId: string
  userId: string | undefined
  round: string
  pointsExact: number
}

/**
 * "Aplicar também nos outros grupos": depois de salvar, copia os palpites salvos
 * para os outros grupos ativos do mesmo campeonato em que a pessoa está. Só entra
 * grupo que ainda aceita palpite. Num grupo "só vencedor", ficam de fora os grupos
 * que pontuam o placar exato, que a API também recusa. A escolha fica no navegador,
 * por usuário e campeonato.
 */
export function usePredictionsReplicate(scope: Scope, siblings: TargetGroup[]) {
  const { groupId, competitionId, userId, round, pointsExact } = scope
  const usable = siblings.filter(
    (g) =>
      g.competition_status !== 'finished' && (pointsExact !== 0 || !((g.points_exact ?? 0) > 0)),
  )
  const targets = usable.slice(0, MAX_REPLICATE_TARGETS)
  const overflow = usable.length - targets.length
  const [enabled, setEnabled] = useState(() => readReplicatePreference(userId, competitionId))
  const [inFlight, setInFlight] = useState(0)
  const [feedback, setFeedbackState] = useState<ReplicateFeedback[]>([])
  const feedbackRef = useRef<ReplicateFeedback[]>([])
  const setFeedback = useCallback((next: ReplicateFeedback[]) => {
    feedbackRef.current = next
    setFeedbackState(next)
  }, [])
  // Trocar de grupo ou de rodada muda a época. Resposta de época antiga não aparece.
  const epoch = useRef(0)
  const nextId = useRef(0)
  const latest = useRef({ groupId, targets, enabled })
  useEffect(() => {
    latest.current = { groupId, targets, enabled }
  })

  useEffect(() => {
    epoch.current += 1
    setEnabled(readReplicatePreference(userId, competitionId))
    setFeedback([])
    setInFlight(0)
  }, [groupId, competitionId, userId, round])

  function handleToggle(next: boolean) {
    setEnabled(next)
    setFeedback([])
    writeReplicatePreference(userId, competitionId, next)
    trackEvent('change_predictions_aplicar_outros_grupos', { enabled: next })
  }

  const push = useCallback(
    (entry: Omit<ReplicateFeedback, 'id'>) =>
      setFeedback(
        [...feedbackRef.current, { ...entry, id: ++nextId.current }].slice(-MAX_FEEDBACK),
      ),
    [setFeedback],
  )

  const replicate = useCallback(
    async (matchIds: string[]) => {
      const { groupId: source, targets: current, enabled: on } = latest.current
      if (!on || current.length === 0 || matchIds.length === 0) return
      const names = new Map(current.map((g) => [g.id, g.name]))
      const mine = epoch.current
      setInFlight((n) => n + 1)
      try {
        const result = await postReplicate(
          source,
          current.map((g) => g.id),
          matchIds,
        )
        // Os outros grupos mudaram os palpites pendentes do painel.
        invalidateApiCache('groups:')
        if (mine !== epoch.current) return
        trackEvent('click_predictions_aplicar_outros_grupos', {
          groups: result.groups.filter((g) => g.saved > 0).length,
        })
        push({
          ok: true,
          message: describeReplicate(result, (id) => names.get(id) ?? 'outro grupo'),
        })
      } catch (e) {
        if (mine !== epoch.current) return
        push({
          ok: false,
          message: `Salvo só neste grupo. Não foi possível aplicar nos outros. ${(e as Error).message}`,
          matchIds,
        })
      } finally {
        if (mine === epoch.current) setInFlight((n) => Math.max(0, n - 1))
      }
    },
    [push],
  )

  /** Envia de novo os jogos dos envios que falharam. */
  const retry = useCallback(() => {
    const failed = feedbackRef.current.filter((f) => !f.ok)
    const ids = Array.from(new Set(failed.flatMap((f) => f.matchIds ?? [])))
    setFeedback(feedbackRef.current.filter((f) => f.ok))
    void replicate(ids)
  }, [replicate, setFeedback])

  return {
    replicateTargets: targets,
    replicateOverflow: overflow,
    replicateEnabled: enabled,
    replicating: inFlight > 0,
    replicateFeedback: feedback,
    handleReplicateToggle: handleToggle,
    replicate,
    retryReplicate: retry,
  }
}
