import { defaultRoundSql, leftoverRoundsSql, roundRuleBinds } from '../matches/defaultRound'
import { lockedSql } from '../matches/locking'

/**
 * Contagem de palpites pendentes do usuário autenticado no grupo. Soma:
 *
 * 1. os jogos abertos da rodada que `GET /matches` escolhe como `default_round`
 *    (`defaultRoundSql`, a mesma definição dos dois endpoints);
 * 2. os jogos remarcados para o futuro nas outras rodadas que ficaram para trás
 *    (`leftoverRoundsSql`). Têm prazo como os da rodada padrão, e a home é o
 *    único lugar que avisa deles antes de o usuário abrir o grupo. Adiado sem
 *    data nova guarda o horário passado (ADR-013) e fica fora desta parcela.
 *
 * As duas parcelas não se sobrepõem: a segunda exclui a rodada padrão. Cada uma
 * busca os jogos por `idx_matches_comp_round_start` com a rodada já resolvida.
 * Um `OR` numa contagem só faria o SQLite varrer a competição e reavaliar a
 * subconsulta da rodada a cada jogo.
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
  const openAndMissing = `AND NOT ${lockedSql('m')}
              AND NOT EXISTS (
                SELECT 1 FROM predictions p
                WHERE p.match_id = m.id
                  AND p.group_id = ${groupAlias}.id
                  AND p.user_id = ?
              )`
  return `(
            (
              SELECT COUNT(*)
              FROM matches m
              WHERE m.competition_id = ${competition}
                AND m.round = (${defaultRoundSql(competition, 'mdr')})
                ${openAndMissing}
            ) + (
              SELECT COUNT(*)
              FROM matches m
              WHERE m.competition_id = ${competition}
                AND m.round IN (${leftoverRoundsSql(competition, 'mlo')})
                AND m.start_time > ?
                ${openAndMissing}
            )
          )`
}

/** Binds na ordem exigida por `pendingPredictionsSql`. */
export function pendingPredictionsBinds(nowIso: string, userId: string): string[] {
  return [
    ...roundRuleBinds(nowIso),
    nowIso,
    userId,
    ...roundRuleBinds(nowIso),
    nowIso,
    nowIso,
    userId,
  ]
}
