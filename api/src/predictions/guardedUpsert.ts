import { lockedSql, SQL_NOW } from '../matches/locking'

type PenaltyWinner = 'home' | 'away'

/**
 * Escrita de um palpite que confere a trava no próprio comando. O jogo é relido
 * com o relógio do banco (`SQL_NOW`) e, se travou depois das consultas do handler,
 * o `SELECT` não devolve linha e nada é gravado. A conferência em TypeScript vira
 * resposta rápida e quem decide é este SQL.
 *
 * Com `onlyMissing`, o palpite salvo no destino depois das consultas também fica.
 */
export function prepareGuardedUpsert(
  db: D1Database,
  { onlyMissing = false }: { onlyMissing?: boolean } = {},
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner, created_at, updated_at)
     SELECT ?, ?, ?, m.id, ?, ?, ?, ?, ?
     FROM matches m
     WHERE m.id = ? AND NOT ${lockedSql('m', SQL_NOW)}
     ON CONFLICT (user_id, group_id, match_id) DO ${
       onlyMissing
         ? 'NOTHING'
         : `UPDATE SET
       predicted_home_score     = excluded.predicted_home_score,
       predicted_away_score     = excluded.predicted_away_score,
       predicted_penalty_winner = excluded.predicted_penalty_winner,
       updated_at               = excluded.updated_at`
     }`,
  )
}

/** Ordem dos parâmetros de `prepareGuardedUpsert`. */
export function guardedUpsertParams(row: {
  userId: string
  groupId: string
  matchId: string
  home: number
  away: number
  penaltyWinner: PenaltyWinner | null
  now: string
}): [string, string, string, number, number, PenaltyWinner | null, string, string, string] {
  return [
    crypto.randomUUID(),
    row.userId,
    row.groupId,
    row.home,
    row.away,
    row.penaltyWinner,
    row.now,
    row.now,
    row.matchId,
  ]
}
