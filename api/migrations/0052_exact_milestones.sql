-- Marcos de placares exatos (5, 15, 30) por membro e grupo.
-- O marco é gravado na primeira leitura de round-standings em que o total o
-- alcança. `round` guarda a rodada de referência dessa leitura; NULL marca
-- backfill na primeira leitura do grupo (já atingido antes do deploy, sem
-- destaque). A exclusão de conta ou de grupo remove as linhas em cascata
-- (ADR-026).

CREATE TABLE IF NOT EXISTS exact_milestones (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  threshold INTEGER NOT NULL CHECK (threshold IN (5, 15, 30)),
  round TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id, threshold)
);

CREATE INDEX IF NOT EXISTS idx_exact_milestones_group
  ON exact_milestones(group_id);

-- Cascata da exclusão de conta (ADR-026) localiza as linhas pelo user_id.
CREATE INDEX IF NOT EXISTS idx_exact_milestones_user
  ON exact_milestones(user_id);

-- Grupo já passou pela primeira leitura com rodada de referência após o deploy.
-- Sem esta marca, um grupo novo lido com 0 exatos e depois com 5 seria tratado
-- como backfill e perderia o destaque do primeiro cruzamento.
CREATE TABLE IF NOT EXISTS exact_milestones_initialized (
  group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  initialized_at TEXT NOT NULL DEFAULT (datetime('now'))
);
