-- Penalty-shootout picks for knockout matches.
-- When a knockout match's fullTime (90 + extra time) is a draw, the game was
-- decided on penalties. Users who predicted a draw additionally pick which team
-- wins the shootout for a fixed +1 bonus point. Existing rows default to NULL
-- pick / 0 bonus / enabled — no leaderboard recalculation needed (no knockout
-- match has happened yet).

-- matches: actual shootout result, filled by sync when score.penalties exists.
ALTER TABLE matches ADD COLUMN penalty_winner_team_id TEXT REFERENCES teams(id);
ALTER TABLE matches ADD COLUMN penalty_home_score INTEGER;
ALTER TABLE matches ADD COLUMN penalty_away_score INTEGER;

-- predictions: the user's shootout pick and the bonus it earned.
-- penalty_bonus is kept SEPARATE from points_awarded so the leaderboard's
-- exact_hits criterion (points_awarded = points_exact) stays intact — an exact
-- pick that also nailed the shootout must still count as an exact hit.
ALTER TABLE predictions ADD COLUMN predicted_penalty_winner_team_id TEXT REFERENCES teams(id);
ALTER TABLE predictions ADD COLUMN penalty_bonus INTEGER NOT NULL DEFAULT 0;

-- groups: per-group toggle (default on). When 0, knockout draws score as a plain
-- draw with no shootout pick or bonus.
ALTER TABLE groups ADD COLUMN penalty_picks_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (penalty_picks_enabled IN (0, 1));
