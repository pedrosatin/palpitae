-- Índice de membros por usuário.
--
-- GET /groups parte de "os grupos deste usuário" (`gm.user_id = ?`), mas nenhum
-- índice de group_members começa por user_id. O plano era
-- `SCAN gm USING COVERING INDEX sqlite_autoindex_group_members_2`, que lê a
-- tabela inteira a cada abertura da home. Com este índice vira uma busca por
-- user_id, sem mudar o resultado. Custa uma escrita de índice a mais por
-- entrada e saída de membro.
CREATE INDEX IF NOT EXISTS idx_group_members_user
  ON group_members(user_id, group_id);
