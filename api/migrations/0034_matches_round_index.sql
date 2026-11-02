-- Índice de jogos por competição + rodada (+ horário).
--
-- Várias queries buscam "a rodada atual" de uma competição com
-- `GROUP BY round HAVING MAX(start_time) > ?` ou "o início da rodada" com
-- `MIN(start_time) ... WHERE competition_id = ? AND round = ?`. Só com
-- idx_matches_competition, cada uma dessas subqueries varre todos os jogos da
-- competição, e quando ela é correlacionada a cada jogo (contagem de palpites
-- pendentes em GET /groups, lembrete de rodada) o custo vira jogos × jogos:
-- ~121 mil linhas lidas por GET /groups de um usuário com 6 grupos e ~848 mil
-- por execução do lembrete, com 4 mil jogos no banco. Com este índice as mesmas
-- queries leem ~2,6 mil e ~28 mil linhas, sem mudar o resultado.
--
-- O índice cobre o prefixo competition_id, então idx_matches_competition fica
-- redundante.
CREATE INDEX IF NOT EXISTS idx_matches_comp_round_start
  ON matches(competition_id, round, start_time);

DROP INDEX IF EXISTS idx_matches_competition;

-- Pontuação pendente (scoreUnprocessedMatches): jogos encerrados ainda sem
-- scored_at. Índice parcial, quase sempre vazio, no lugar de varrer a competição
-- inteira a cada tick do poller (~1,7 mil linhas por competição por tick).
CREATE INDEX IF NOT EXISTS idx_matches_unscored
  ON matches(competition_id)
  WHERE status = 'finished' AND scored_at IS NULL;
