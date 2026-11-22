CREATE INDEX IF NOT EXISTS idx_matches_comp_scored
  ON matches(competition_id, scored_at)
  WHERE scored_at IS NOT NULL;
