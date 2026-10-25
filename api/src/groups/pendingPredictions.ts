import { lockedSql } from '../matches/locking'

/**
 * Contagem de palpites pendentes do usuário autenticado no grupo, na mesma
 * rodada que `GET /matches` escolhe como `default_round`: a primeira rodada
 * com `MAX(start_time) > now`. Sem rodada aberta o subquery devolve NULL e a
 * contagem fica 0 (não há pendência acionável na home).
 *
 * Aberto para submissão = `NOT lockedSql` (ADR-004): respeita `locked_at`,
 * live/finished e adiados (`postponed = 1` com horário passado continua aberto
 * até o sync marcar início). Palpite 0x0 já gravado conta como preenchido
 * (`EXISTS` na linha de `predictions`). TBD não entra: o sync ESPN descarta
 * placeholders antes de persistir.
 *
 * Fragmento correlacionado ao alias do grupo (padrão `g`). Ordem dos binds:
 * `nowIso` (HAVING da rodada), `nowIso` (`lockedSql`), `userId` (predição).
 */
export function pendingPredictionsSql(groupAlias = 'g'): string {
  return `(
            SELECT COUNT(*)
            FROM matches m
            WHERE m.competition_id = ${groupAlias}.competition_id
              AND m.round = (
                SELECT mdr.round
                FROM matches mdr
                WHERE mdr.competition_id = ${groupAlias}.competition_id
                GROUP BY mdr.round
                HAVING MAX(mdr.start_time) > ?
                ORDER BY MAX(mdr.start_time) ASC
                LIMIT 1
              )
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
export function pendingPredictionsBinds(nowIso: string, userId: string): [string, string, string] {
  return [nowIso, nowIso, userId]
}
