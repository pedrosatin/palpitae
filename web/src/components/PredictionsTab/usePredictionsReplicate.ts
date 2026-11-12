import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { trackEvent } from '../../analytics/ga'
import { invalidateApiCache } from '../../lib/api-cache'
import { readReplicatePreference, writeReplicatePreference } from '../../lib/replicatePreference'
import {
  clearReplicateFeedback,
  finishReplicate,
  keepReplicateFeedback,
  readReplicateStatus,
  replicateContextKey,
  startReplicate,
  subscribeReplicateStatus,
  viewReplicateContext,
} from '../../lib/replicateStatus'
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

type Scope = {
  groupId: string
  competitionId: string
  userId: string | undefined
  round: string | undefined
  pointsExact: number
}

/**
 * "Aplicar também nos outros grupos": depois de salvar, copia os palpites salvos
 * para os outros grupos ativos do mesmo campeonato em que a pessoa está. Só entra
 * grupo que ainda aceita palpite. Num grupo "só vencedor", ficam de fora os grupos
 * que pontuam o placar exato, que a API também recusa. A escolha fica no navegador,
 * por usuário e campeonato.
 *
 * Cada envio pertence ao grupo e à rodada dos jogos salvos. A resposta que volta
 * depois de trocar de rodada ou de grupo fica guardada lá e aparece quando a pessoa
 * volta; a rodada exibida não mostra resultado de outra. A confirmação de sucesso
 * sai quando a pessoa deixa o contexto em que a viu.
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
  const viewKey = replicateContextKey(userId, groupId, round)
  const readView = () => readReplicateStatus(viewKey)
  const { inFlight, feedback } = useSyncExternalStore(subscribeReplicateStatus, readView, readView)
  const latest = useRef({ groupId, userId, round, targets, enabled })
  useEffect(() => {
    latest.current = { groupId, userId, round, targets, enabled }
  })

  // Confirmações de sucesso mostradas neste contexto. Saem do contexto quando a
  // pessoa troca de rodada ou de grupo; numa rodada sem jogo aberto, a opção some e
  // não haveria como tirá-las da barra.
  // A troca de contexto vem antes do registro do que a tela mostra.
  const shown = useRef(new Set<number>())
  useEffect(() => {
    const seen = new Set<number>()
    shown.current = seen
    const leave = viewReplicateContext(viewKey)
    return () => leave(seen)
  }, [viewKey])
  useEffect(() => {
    for (const f of feedback) if (f.ok) shown.current.add(f.id)
  }, [feedback])

  useEffect(() => {
    setEnabled(readReplicatePreference(userId, competitionId))
  }, [competitionId, userId])

  function handleToggle(next: boolean) {
    setEnabled(next)
    // A confirmação de antes não vale para o que for salvo com a opção nova.
    clearReplicateFeedback(userId, groupId)
    writeReplicatePreference(userId, competitionId, next)
    trackEvent('change_predictions_aplicar_outros_grupos', { enabled: next })
  }

  /**
   * Envia `matchIds` para os outros grupos. `originRound` é a rodada dos jogos
   * salvos; o resultado fica nela, mesmo que a tela já mostre outra.
   */
  const replicate = useCallback(async (matchIds: string[], originRound?: string) => {
    const { groupId: source, userId: user, round: shown, targets: current, enabled: on } =
      latest.current
    if (!on || current.length === 0 || matchIds.length === 0) return
    const names = new Map(current.map((g) => [g.id, g.name]))
    const origin = replicateContextKey(user, source, originRound ?? shown)
    startReplicate(origin)
    try {
      const result = await postReplicate(
        source,
        current.map((g) => g.id),
        matchIds,
      )
      // Os outros grupos mudaram os palpites pendentes do painel.
      invalidateApiCache('groups:')
      trackEvent('click_predictions_aplicar_outros_grupos', {
        groups: result.groups.filter((g) => g.saved > 0).length,
      })
      finishReplicate(origin, {
        ok: true,
        message: describeReplicate(result, (id) => names.get(id) ?? 'outro grupo'),
      })
    } catch (e) {
      finishReplicate(origin, {
        ok: false,
        message: `Salvo só neste grupo. Não foi possível aplicar nos outros. ${(e as Error).message}`,
        matchIds,
      })
    }
  }, [])

  // Sem a opção marcada ou sem grupo de destino, não há para onde reenviar.
  const canRetry =
    enabled && targets.length > 0 && inFlight === 0 && feedback.some((f) => !f.ok)

  /** Envia de novo os jogos dos envios que falharam na rodada exibida. */
  const retry = useCallback(() => {
    const { targets: current, enabled: on } = latest.current
    if (!on || current.length === 0) return
    const ids = Array.from(new Set(feedback.filter((f) => !f.ok).flatMap((f) => f.matchIds ?? [])))
    keepReplicateFeedback(viewKey, (f) => f.ok)
    void replicate(ids, round)
  }, [feedback, viewKey, round, replicate])

  return {
    replicateTargets: targets,
    replicateOverflow: overflow,
    replicateEnabled: enabled,
    replicating: inFlight > 0,
    replicateFeedback: feedback,
    handleReplicateToggle: handleToggle,
    replicate,
    canRetryReplicate: canRetry,
    retryReplicate: retry,
  }
}
