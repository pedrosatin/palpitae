/**
 * Estado de "Aplicar também nos outros grupos" por contexto de origem: usuário,
 * grupo e rodada em que o palpite foi salvo. Fica fora do componente porque a
 * resposta pode voltar depois que a pessoa trocou de rodada ou de grupo (a aba
 * remonta). O resultado fica no contexto de origem e aparece quando ela volta
 * para lá. Vale até recarregar a página.
 */

export type ReplicateFeedback = {
  id: number
  ok: boolean
  message: string
  /** Jogos do envio que falhou, para tentar de novo. */
  matchIds?: string[]
}

export type ReplicateStatus = {
  /** Envios ainda sem resposta. */
  inFlight: number
  feedback: ReplicateFeedback[]
}

/** Confirmações que ficam na barra ao mesmo tempo. As mais antigas saem primeiro. */
const MAX_FEEDBACK = 3

const EMPTY: ReplicateStatus = { inFlight: 0, feedback: [] }

const statuses = new Map<string, ReplicateStatus>()
const listeners = new Set<() => void>()
let nextId = 0

export function replicateContextKey(
  userId: string | undefined,
  groupId: string,
  round: string | undefined,
): string {
  return JSON.stringify([userId ?? '', groupId, round ?? ''])
}

/** Mesmo objeto enquanto o contexto não muda, como pede o `useSyncExternalStore`. */
export function readReplicateStatus(key: string): ReplicateStatus {
  return statuses.get(key) ?? EMPTY
}

export function subscribeReplicateStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function update(key: string, change: (status: ReplicateStatus) => ReplicateStatus) {
  const next = change(readReplicateStatus(key))
  if (next.inFlight === 0 && next.feedback.length === 0) statuses.delete(key)
  else statuses.set(key, next)
  for (const listener of listeners) listener()
}

/** Marca um envio em andamento no contexto. */
export function startReplicate(key: string) {
  update(key, (s) => ({ ...s, inFlight: s.inFlight + 1 }))
}

/** Fecha um envio do contexto e guarda o resultado dele. */
export function finishReplicate(key: string, entry: Omit<ReplicateFeedback, 'id'>) {
  update(key, (s) => ({
    inFlight: Math.max(0, s.inFlight - 1),
    feedback: [...s.feedback, { ...entry, id: ++nextId }].slice(-MAX_FEEDBACK),
  }))
}

/** Mantém só as confirmações do contexto que passam no filtro. */
export function keepReplicateFeedback(key: string, keep: (f: ReplicateFeedback) => boolean) {
  update(key, (s) => ({ ...s, feedback: s.feedback.filter(keep) }))
}

/** Para testes: esquece todos os contextos. */
export function resetReplicateStatus() {
  statuses.clear()
  for (const listener of listeners) listener()
}
