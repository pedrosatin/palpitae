
CREATE TABLE IF NOT EXISTS match_score_rarity (
  match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  tipster_count INTEGER NOT NULL CHECK (tipster_count >= 0),
  exact_count INTEGER NOT NULL CHECK (exact_count >= 0),
  scored_at_snapshot TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('computing', 'ready'))
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
