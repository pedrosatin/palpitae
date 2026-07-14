-- Fase 4 (validação) — consultas READ-ONLY pós-import. Valores esperados no comentário.
-- Rodar com:
--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/05-validate.sql

-- Jogos do BSA sincronizados (esperado: 380 após o cron de discovery)
SELECT COUNT(*) AS bsa_matches FROM matches
 WHERE competition_id = '06baa1de-01c3-4e71-ac6e-a850fa690ec1';

-- Predictions importadas (esperado: 773; menos que isso = subselect não achou jogo)
SELECT COUNT(*) AS imported FROM predictions
 WHERE group_id = 'd79438a7-a324-48d0-a245-950aff4d5849';

-- Totais por jogador (esperado: WEEGEE/Gustavo 106·155, Chu 98·158, satin 88·160,
-- Isa 61·113, PDR 54·100, FABRE 42·87)
SELECT COALESCE(pr.nickname, u.email) AS jogador,
       COUNT(*)                        AS palpites,
       SUM(p.points_awarded)           AS pontos
  FROM predictions p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN profiles pr ON pr.user_id = u.id
 WHERE p.group_id = 'd79438a7-a324-48d0-a245-950aff4d5849'
 GROUP BY p.user_id
 ORDER BY pontos DESC;

-- Leaderboard materializado bate com as predictions (esperado: 0 linhas)
SELECT l.user_id FROM leaderboard l
 WHERE l.group_id = 'd79438a7-a324-48d0-a245-950aff4d5849'
   AND l.total_points != (SELECT COALESCE(SUM(p.points_awarded + p.penalty_points),0)
                            FROM predictions p
                           WHERE p.group_id = l.group_id AND p.user_id = l.user_id);
