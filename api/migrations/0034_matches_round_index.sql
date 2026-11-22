CREATE INDEX IF NOT EXISTS idx_matches_comp_round_start
  ON matches(competition_id, round, start_time);

DROP INDEX IF EXISTS idx_matches_competition;

CREATE INDEX IF NOT EXISTS idx_matches_unscored
  ON matches(competition_id)
  WHERE status = 'finished' AND scored_at IS NULL;
