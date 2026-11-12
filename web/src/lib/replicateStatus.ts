/**
 * Estado de "Aplicar também nos outros grupos" por contexto de origem: usuário,
 * grupo e rodada em que o palpite foi salvo. Fica fora do componente porque a
 * resposta pode voltar depois que a pessoa trocou de rodada ou de grupo (na troca
 * de grupo a aba remonta). O resultado fica no contexto de origem e aparece quando
 * ela volta para lá. A confirmação de sucesso sai depois de vista uma vez; a falha
 * fica até uma nova tentativa. Vale até recarregar a página.
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
/** Telas que mostram cada contexto agora. */
const viewers = new Map<string, number>()
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
  const current = readReplicateStatus(key)
  const next = change(current)
  if (next === current) return
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
  update(key, (s) => {
    const feedback = s.feedback.filter(keep)
    return feedback.length === s.feedback.length ? s : { ...s, feedback }
  })
}

/** Apaga as confirmações de todas as rodadas do usuário no grupo. */
export function clearReplicateFeedback(userId: string | undefined, groupId: string) {
  for (const key of Array.from(statuses.keys())) {
    const [user, group] = JSON.parse(key) as string[]
    if (user === (userId ?? '') && group === groupId) keepReplicateFeedback(key, () => false)
  }
}

/**
 * A tela passou a mostrar o contexto. A função devolvida marca a saída: as
 * confirmações de sucesso em `shownIds` já foram vistas e saem do contexto. A
 * checagem espera uma microtarefa porque o StrictMode desmonta e monta o efeito de
 * novo na mesma hora, e essa volta imediata não conta como saída.
 */
export function viewReplicateContext(key: string): (shownIds: ReadonlySet<number>) => void {
  viewers.set(key, (viewers.get(key) ?? 0) + 1)
  return (shownIds) => {
    viewers.set(key, (viewers.get(key) ?? 1) - 1)
    queueMicrotask(() => {
      if ((viewers.get(key) ?? 0) > 0) return
      viewers.delete(key)
      keepReplicateFeedback(key, (f) => !f.ok || !shownIds.has(f.id))
    })
  }
}

/** Para testes: esquece todos os contextos. */
export function resetReplicateStatus() {
  statuses.clear()
  viewers.clear()
  for (const listener of listeners) listener()
}
