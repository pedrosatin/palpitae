
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

CREATE TABLE IF NOT EXISTS exact_milestones_initialized (
  group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  initialized_at TEXT NOT NULL DEFAULT (datetime('now'))
);
