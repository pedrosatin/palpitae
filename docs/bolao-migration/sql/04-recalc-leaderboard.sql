-- Fase 4 — Recalcula o leaderboard do grupo migrado (mesma lógica de
-- recalculateLeaderboard em api/src/matches/scoring.ts; para este grupo
-- points_exact=3 > points_winner=1, então exact_hit ⇔ points_awarded = 3).
-- Idempotente: upsert por (group_id, user_id).
--
-- Aplicar com:
--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/04-recalc-leaderboard.sql

INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated)
SELECT p.group_id,
       p.user_id,
       SUM(p.points_awarded + p.penalty_points),
       SUM(CASE WHEN p.points_awarded = 3 THEN 1 ELSE 0 END),
       datetime('now')
  FROM predictions p
 WHERE p.group_id = 'd79438a7-a324-48d0-a245-950aff4d5849'
 GROUP BY p.user_id
ON CONFLICT (group_id, user_id) DO UPDATE SET
  total_points = excluded.total_points,
  exact_hits   = excluded.exact_hits,
  last_updated = excluded.last_updated;
