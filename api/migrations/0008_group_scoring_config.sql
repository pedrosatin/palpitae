-- Per-group scoring rules and prediction visibility, set at creation and immutable after.
-- Existing groups inherit the defaults, so no leaderboard recalculation is needed.
ALTER TABLE groups ADD COLUMN points_exact INTEGER NOT NULL DEFAULT 3 CHECK (points_exact BETWEEN 0 AND 10);
ALTER TABLE groups ADD COLUMN points_winner INTEGER NOT NULL DEFAULT 1 CHECK (points_winner BETWEEN 0 AND 10);
ALTER TABLE groups ADD COLUMN predictions_visibility TEXT NOT NULL DEFAULT 'hidden' CHECK (predictions_visibility IN ('hidden', 'public'));
