/**
 * Guarda no navegador a escolha de "Aplicar também nos outros grupos", por usuário
 * e campeonato. Sem escolha anterior, a opção começa desmarcada, e nada vai para
 * outro grupo sem a pessoa marcar.
 *
 * Todo acesso ao `localStorage` fica em try/catch. Em modo restrito, com a cota
 * cheia ou no SSR, a opção funciona na visita atual e só não é lembrada depois.
 */
const KEY_PREFIX = 'palpitae:aplicar-outros-grupos'

export function replicatePreferenceKey(userId: string, competitionId: string): string {
  return `${KEY_PREFIX}:${userId}:${competitionId}`
}

export function readReplicatePreference(
  userId: string | undefined,
  competitionId: string,
): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(replicatePreferenceKey(userId, competitionId)) === '1'
  } catch {
    return false
  }
}

export function writeReplicatePreference(
  userId: string | undefined,
  competitionId: string,
  enabled: boolean,
): void {
  if (!userId) return
  try {
    localStorage.setItem(replicatePreferenceKey(userId, competitionId), enabled ? '1' : '0')
  } catch {
    // Sem armazenamento a escolha vale só nesta visita.
  }
}
