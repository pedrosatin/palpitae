import { openRoundsSql, roundRuleBinds } from '../matches/defaultRound'
import { lockedSql } from '../matches/locking'

/**
 * Contagem de palpites pendentes do usuário autenticado no grupo. Soma:
 *
 * 1. os jogos abertos da rodada que `GET /matches` escolhe como `default_round`
 *    (`position = 1` em `openRoundsSql`, a mesma ordem de `defaultRoundSql`);
 * 2. os jogos remarcados para o futuro nas outras rodadas que ficaram para trás.
 *    Têm prazo como os da rodada padrão, e a home é o único lugar que avisa
 *    deles antes de o usuário abrir o grupo. Adiado sem data nova guarda o
 *    horário passado (ADR-013) e fica fora desta parcela.
 *
 * As duas parcelas saem de uma varredura só do índice coberto da competição,
 * que numera as candidatas e já traz a rodada padrão e as que ficaram para trás.
 * Os jogos de cada rodada vêm de `idx_matches_comp_round_start` com a rodada já
 * resolvida. O `CROSS JOIN` fixa essa ordem. Com `JOIN` o SQLite pode começar
 * pelos jogos e varrer a competição.
 *
 * Sem rodada aberta a contagem fica 0 (não há pendência acionável na home).
 *
 * Aberto para submissão = `NOT lockedSql` (ADR-004): respeita `locked_at`,
 * live/finished e adiados (`postponed = 1` com horário passado continua aberto
 * até o sync marcar início). Palpite 0x0 já gravado conta como preenchido
 * (`EXISTS` na linha de `predictions`). TBD não entra: o sync ESPN descarta
 * placeholders antes de persistir.
 *
 * Fragmento correlacionado ao alias do grupo (padrão `g`). Binds na ordem de
 * `pendingPredictionsBinds`.
 */
export function pendingPredictionsSql(groupAlias = 'g'): string {
  const competition = `${groupAlias}.competition_id`
  return `(
            SELECT COUNT(*)
            FROM (${openRoundsSql(competition, 'mr')}) r
            CROSS JOIN matches m
              ON m.competition_id = ${competition}
             AND m.round = r.round
            WHERE (r.position = 1 OR m.start_time > ?)
              AND NOT ${lockedSql('m')}
              AND NOT EXISTS (
                SELECT 1 FROM predictions p
                WHERE p.match_id = m.id
                  AND p.group_id = ${groupAlias}.id
                  AND p.user_id = ?
              )
          )`
}

/** Binds na ordem exigida por `pendingPredictionsSql`. */
export function pendingPredictionsBinds(nowIso: string, userId: string): string[] {
  return [...roundRuleBinds(nowIso), nowIso, nowIso, userId]
}
