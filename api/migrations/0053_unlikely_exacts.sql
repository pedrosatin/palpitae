-- Placares exatos improváveis (raridade na competição inteira).
-- Gravado na primeira leitura de round-standings em que o placar do membro
-- na rodada de referência é raro entre os palpiteiros distintos do jogo
-- (X = 10%, M = 10). A linha congela tipster_count e o percentual exibido;
-- correção de placar ou repontuação não redispara nem apaga o reconhecimento
-- (ADR-029). Cascata com exclusão de conta, grupo ou jogo.

CREATE TABLE IF NOT EXISTS unlikely_exacts (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round TEXT NOT NULL,
  tipster_count INTEGER NOT NULL CHECK (tipster_count >= 10),
  exact_tipster_count INTEGER NOT NULL CHECK (exact_tipster_count >= 1),
  percent_rounded INTEGER NOT NULL CHECK (percent_rounded BETWEEN 1 AND 10),
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_unlikely_exacts_group_round
  ON unlikely_exacts(group_id, round);

CREATE INDEX IF NOT EXISTS idx_unlikely_exacts_user
  ON unlikely_exacts(user_id);
