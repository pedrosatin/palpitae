import { useCallback, useEffect, useRef, useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import { invalidateApiCache } from '../../lib/api-cache'
import { readReplicatePreference, writeReplicatePreference } from '../../lib/replicatePreference'
import { describeReplicate, postReplicate } from '../../lib/replicateToGroups'

type TargetGroup = { id: string; name: string; competition_status?: string | null }
type Feedback = { ok: boolean; message: string }

/**
 * "Aplicar também nos outros grupos": depois de salvar, copia os palpites salvos
 * para os outros grupos ativos do mesmo campeonato em que a pessoa está. Só entra
 * grupo que ainda aceita palpite. A escolha fica no navegador, por usuário e campeonato.
 */
export function usePredictionsReplicate(
  groupId: string,
  competitionId: string,
  userId: string | undefined,
  siblings: TargetGroup[],
) {
  const targets = siblings.filter((g) => g.competition_status !== 'finished')
  const [enabled, setEnabled] = useState(() => readReplicatePreference(userId, competitionId))
  const [replicating, setReplicating] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // Só a resposta do último envio atualiza a tela. Trocar de grupo invalida os anteriores.
  const sequence = useRef(0)
  const latest = useRef({ groupId, targets, enabled })
  useEffect(() => {
    latest.current = { groupId, targets, enabled }
  })

  useEffect(() => {
    sequence.current += 1
    setEnabled(readReplicatePreference(userId, competitionId))
    setFeedback(null)
    setReplicating(false)
  }, [groupId, competitionId, userId])

  function handleToggle(next: boolean) {
    setEnabled(next)
    setFeedback(null)
    writeReplicatePreference(userId, competitionId, next)
    trackEvent('change_predictions_aplicar_outros_grupos', { enabled: next })
  }

  const replicate = useCallback(async (matchIds: string[]) => {
    const { groupId: source, targets: current, enabled: on } = latest.current
    if (!on || current.length === 0 || matchIds.length === 0) return
    const names = new Map(current.map((g) => [g.id, g.name]))
    const seq = ++sequence.current
    setReplicating(true)
    setFeedback(null)
    try {
      const result = await postReplicate(
        source,
        current.map((g) => g.id),
        matchIds,
      )
      if (seq !== sequence.current) return
      // Os outros grupos mudaram os palpites pendentes do painel.
      invalidateApiCache('groups:')
      trackEvent('click_predictions_aplicar_outros_grupos', {
        groups: result.groups.filter((g) => g.saved > 0).length,
      })
      setFeedback({
        ok: true,
        message: describeReplicate(result, (id) => names.get(id) ?? 'outro grupo'),
      })
    } catch (e) {
      if (seq !== sequence.current) return
      setFeedback({
        ok: false,
        message: `Salvo neste grupo, mas não foi possível aplicar nos outros. ${(e as Error).message}`,
      })
    } finally {
      if (seq === sequence.current) setReplicating(false)
    }
  }, [])

  return {
    replicateTargets: targets,
    replicateEnabled: enabled,
    replicating,
    replicateFeedback: feedback,
    handleReplicateToggle: handleToggle,
    replicate,
  }
}
