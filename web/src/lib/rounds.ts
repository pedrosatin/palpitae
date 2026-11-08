// O rótulo de exibição (`round_label`) vem pronto da API (`GET /matches`) — a fonte
// única é o back (`api/src/matches/rounds.ts`). Aqui fica só a lógica client-side
// que deriva do `round` cru e não tem por que ir ao servidor.

export function isGroupStageRound(round: string): boolean {
  return /^\d+$/.test(round)
}

/** Caminho da aba Palpitar do grupo, aberta na rodada quando há uma. */
export function predictionsPath(groupId: string, round: string | null): string {
  const base = `/grupos/${groupId}`
  return round ? `${base}?rodada=${encodeURIComponent(round)}` : base
}

// null = no future round; undefined = pre-deploy cache without the field.
// Both cases fall back to the last round (preserves old behaviour).
export function applyDefaultRound(
  defaultRound: string | null | undefined,
  rounds: string[],
  setRoundIndex: (i: number) => void,
): void {
  if (defaultRound != null) {
    const idx = rounds.indexOf(defaultRound)
    setRoundIndex(idx >= 0 ? idx : rounds.length - 1)
  } else if (rounds.length > 0) {
    setRoundIndex(rounds.length - 1)
  }
}

/**
 * Espelha `LEFTOVER_ROUND_AGE_DAYS` de `api/src/matches/defaultRound.ts`: rodada
 * que ficou para trás é aquela em que a maioria dos jogos começou há mais de 7
 * dias. A API tira essa rodada do `default_round` mesmo com jogo futuro; o front
 * usa a mesma regra para avisar do jogo remarcado que ficou nela.
 */
export const LEFTOVER_ROUND_AGE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

interface RoundMatch {
  start_time: string
  status: string
  postponed?: number | boolean
  locked_at?: string | null
}

export function isLeftoverRound(matches: RoundMatch[], nowMs: number): boolean {
  const cutoff = nowMs - LEFTOVER_ROUND_AGE_DAYS * DAY_MS
  const old = matches.filter((m) => Date.parse(m.start_time) <= cutoff).length
  return old * 2 > matches.length
}

/**
 * Jogos remarcados com palpite aberto por rodada que ficou para trás: horário
 * futuro, não adiado e não travado. Adiado sem data nova conta como adiado
 * (ADR-013), não como remarcado.
 *
 * A rodada padrão é o `default_round` da API e fica de fora mesmo quando também
 * ficou para trás, como no fim de temporada ou numa fase única como a
 * `REGULAR_SEASON` da Série B. Nesses casos ela é a rodada aberta, não uma rodada
 * esquecida. O front não recalcula a padrão. Num empate a ordem da API decide, e
 * a dica tem de apontar a outra rodada.
 */
export function rescheduledOpenByRound(
  rounds: Map<string, RoundMatch[]>,
  nowMs: number,
  defaultRound: string | null | undefined,
): Map<string, number> {
  const result = new Map<string, number>()
  for (const [round, list] of rounds) {
    if (round === defaultRound || !isLeftoverRound(list, nowMs)) continue
    const count = list.filter(
      (m) =>
        !m.postponed &&
        !m.locked_at &&
        m.status === 'scheduled' &&
        Date.parse(m.start_time) > nowMs,
    ).length
    if (count > 0) result.set(round, count)
  }
  return result
}

const s = (count: number) => (count > 1 ? 's' : '')

/** Texto da dica: "2 jogos adiados", "1 jogo remarcado", "1 jogo adiado e 1 remarcado". */
export function leftoverMatchesText(postponed: number, rescheduled: number): string {
  if (postponed > 0 && rescheduled > 0) {
    return `${postponed} jogo${s(postponed)} adiado${s(postponed)} e ${rescheduled} remarcado${s(rescheduled)}`
  }
  if (postponed > 0) return `${postponed} jogo${s(postponed)} adiado${s(postponed)}`
  return `${rescheduled} jogo${s(rescheduled)} remarcado${s(rescheduled)}`
}

/** Marcador do seletor de rodadas: "2 adiados", "1 remarcado", "2 adiados, 1 remarcado". */
export function leftoverMatchesMarker(postponed: number, rescheduled: number): string {
  const parts: string[] = []
  if (postponed > 0) parts.push(`${postponed} adiado${s(postponed)}`)
  if (rescheduled > 0) parts.push(`${rescheduled} remarcado${s(rescheduled)}`)
  return parts.join(', ')
}
