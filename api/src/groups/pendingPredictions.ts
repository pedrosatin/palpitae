import { openRoundsSql, roundRuleBinds } from '../matches/defaultRound'
import { lockedSql } from '../matches/locking'

/**
 * Resumo dos jogos abertos do grupo para o painel, numa subquery correlacionada
 * ao grupo que devolve um objeto JSON. Os jogos são os mesmos da contagem de
 * palpites pendentes:
 *
 * 1. os jogos abertos da rodada que `GET /matches` escolhe como `default_round`
 *    (`position = 1` em `openRoundsSql`, a mesma ordem de `defaultRoundSql`);
 * 2. os jogos remarcados para o futuro nas outras rodadas que ficaram para trás.
 *    Têm prazo como os da rodada padrão, e a home é o único lugar que avisa
 *    deles antes de o usuário abrir o grupo. Adiado sem data nova guarda o
 *    horário passado (ADR-013) e fica fora desta parcela.
 *
 * Campos do JSON, lidos por `parsePendingSummary`:
 *
 * - `pending`: jogos sem palpite do usuário no grupo.
 * - `deadline`: `start_time|id` do jogo sem palpite que começa primeiro. Só conta
 *   jogo com horário futuro. O adiado sem data nova entra em `pending` e fica
 *   sem prazo.
 * - `next_match_at`: horário do próximo jogo, com ou sem palpite.
 * - `round`: a rodada padrão.
 * - `round_ends_at`: horário do último jogo aberto da rodada padrão. Quando ele
 *   começa, a rodada seguinte vira padrão e traz pendências novas.
 *
 * Tudo sai de uma varredura só do índice coberto da competição, que numera as
 * candidatas e já traz a rodada padrão e as que ficaram para trás. Os jogos de
 * cada rodada vêm de `idx_matches_comp_round_start` com a rodada já resolvida,
 * e o palpite de cada jogo vem do índice único de `predictions`. O `CROSS JOIN`
 * fixa essa ordem. Com `JOIN` o SQLite pode começar pelos jogos e varrer a
 * competição. Um campo a mais no painel entra neste JSON. Outra subquery por
 * campo leria o índice da competição de novo para cada grupo.
 *
 * Sem rodada aberta, `pending` fica 0 e os horários ficam nulos.
 *
 * Aberto para submissão = `NOT lockedSql` (ADR-004): respeita `locked_at`,
 * live/finished e adiados (`postponed = 1` com horário passado continua aberto
 * até o sync marcar início). Palpite 0x0 já gravado conta como preenchido,
 * porque a linha existe em `predictions`. TBD não entra: o sync ESPN descarta
 * placeholders antes de persistir.
 *
 * Fragmento correlacionado ao alias do grupo (padrão `g`). Binds na ordem de
 * `pendingSummaryBinds`.
 */
export function pendingSummarySql(groupAlias = 'g'): string {
  const competition = `${groupAlias}.competition_id`
  return `(
            SELECT json_object(
              'pending', COUNT(*) - COUNT(p.match_id),
              'deadline', MIN(CASE WHEN p.match_id IS NULL AND m.start_time > ? THEN m.start_time || '|' || m.id END),
              'next_match_at', MIN(CASE WHEN m.start_time > ? THEN m.start_time END),
              'round', MIN(CASE WHEN r.position = 1 THEN r.round END),
              'round_ends_at', MAX(CASE WHEN r.position = 1 THEN m.start_time END)
            )
            FROM (${openRoundsSql(competition, 'mr')}) r
            CROSS JOIN matches m
              ON m.competition_id = ${competition}
             AND m.round = r.round
            LEFT JOIN predictions p
              ON p.user_id = ?
             AND p.group_id = ${groupAlias}.id
             AND p.match_id = m.id
            WHERE (r.position = 1 OR m.start_time > ?)
              AND NOT ${lockedSql('m')}
          )`
}

/** Binds na ordem exigida por `pendingSummarySql`. */
export function pendingSummaryBinds(nowIso: string, userId: string): string[] {
  return [nowIso, nowIso, ...roundRuleBinds(nowIso), userId, nowIso, nowIso]
}

export type PendingSummary = {
  pending: number
  /** Jogo sem palpite que começa primeiro. */
  deadline: { match_id: string; start_time: string } | null
  next_match_at: string | null
  round: string | null
  round_ends_at: string | null
}

const EMPTY_SUMMARY: PendingSummary = {
  pending: 0,
  deadline: null,
  next_match_at: null,
  round: null,
  round_ends_at: null,
}

/** Lê o JSON de `pendingSummarySql`. Valor ausente ou inválido vira resumo vazio. */
export function parsePendingSummary(raw: string | null | undefined): PendingSummary {
  if (!raw) return EMPTY_SUMMARY
  let value: Record<string, unknown>
  try {
    value = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return EMPTY_SUMMARY
  }
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  const deadlineKey = text(value.deadline)
  const separator = deadlineKey?.indexOf('|') ?? -1
  return {
    pending: typeof value.pending === 'number' ? value.pending : 0,
    deadline:
      deadlineKey && separator > 0
        ? {
            start_time: deadlineKey.slice(0, separator),
            match_id: deadlineKey.slice(separator + 1),
          }
        : null,
    next_match_at: text(value.next_match_at),
    round: text(value.round),
    round_ends_at: text(value.round_ends_at),
  }
}
