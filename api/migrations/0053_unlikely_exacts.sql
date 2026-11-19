-- Placares exatos improváveis (raridade na competição inteira).
--
-- `match_score_rarity` guarda o agregado por jogo (palpiteiros distintos e
-- exatos), compartilhado entre todos os grupos. Calculado na primeira leitura
-- de round-standings que precisa dele, ou de novo quando `matches.scored_at`
-- diverge de `scored_at_snapshot` (correção de placar / repontuação). Exclusão
-- de grupo ou usuário fica defasada até a próxima repontuação do jogo (ADR-029).
--
-- `unlikely_exacts` grava o reconhecimento do membro na primeira leitura em que
-- o placar é raro na rodada de referência (X = 10%, M = 10 tipsters no total e
-- M = 10 tipsters fora do grupo). A linha congela as contagens; correção de
-- placar não redispara nem apaga o reconhecimento. Cascata com exclusão de
-- conta, grupo ou jogo.

CREATE TABLE IF NOT EXISTS match_score_rarity (
  match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  tipster_count INTEGER NOT NULL CHECK (tipster_count >= 0),
  exact_count INTEGER NOT NULL CHECK (exact_count >= 0),
  scored_at_snapshot TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS unlikely_exacts (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round TEXT NOT NULL,
  tipster_count INTEGER NOT NULL CHECK (tipster_count >= 10),
  exact_tipster_count INTEGER NOT NULL CHECK (exact_tipster_count >= 1),
  outside_tipster_count INTEGER NOT NULL CHECK (outside_tipster_count >= 10),
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_unlikely_exacts_group_round
  ON unlikely_exacts(group_id, round);

CREATE INDEX IF NOT EXISTS idx_unlikely_exacts_user
  ON unlikely_exacts(user_id);
