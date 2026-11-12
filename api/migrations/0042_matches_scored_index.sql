-- Versão do cache de borda de GET /matches.
--
-- Antes de consultar o cache, a rota lê a visibilidade da competição e o
-- MAX(scored_at) dos jogos dela, que entra na chave: um placar corrigido e
-- repontuado muda a chave e a lista sai do cache longo. Com este índice o MAX
-- lê uma entrada do índice. Sem ele, cada requisição servida pelo cache leria
-- todos os jogos da competição (~380 numa liga de 20 times).
--
-- Parcial: só uma query com `scored_at IS NOT NULL` pode usá-lo. Um índice
-- completo em (competition_id, scored_at) competiria com
-- idx_matches_comp_round_start nas buscas por competition_id e mudaria o plano
-- de outras consultas.
--
-- Só cria índice: o Worker anterior continua funcionando durante o deploy.
CREATE INDEX IF NOT EXISTS idx_matches_comp_scored
  ON matches(competition_id, scored_at)
  WHERE scored_at IS NOT NULL;
