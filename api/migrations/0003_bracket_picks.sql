CREATE TABLE IF NOT EXISTS bracket_picks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  round TEXT NOT NULL CHECK (round IN ('LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL', 'THIRD_PLACE')),
  position INTEGER NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, user_id, round, position)
);

CREATE INDEX IF NOT EXISTS idx_bracket_picks_group_user ON bracket_picks(group_id, user_id);jhkjhkjhsdserew
CREATE INDEX IF NOT EXISTS idx_bracket_picks_group ON bracket_picks(group_id);
CREATE INDEX IF NOT EXISTS idx_bracket_picks_competition ON bracket_picks(competition_id);
