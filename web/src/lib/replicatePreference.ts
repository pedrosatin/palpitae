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
