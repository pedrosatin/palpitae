
-- Fonte de verdade do gate: JSON array das fases (stage) que vão a pênalti em jogo único.
ALTER TABLE competitions ADD COLUMN penalty_phases TEXT NOT NULL DEFAULT '[]';

UPDATE competitions
   SET penalty_phases = '["LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","THIRD_PLACE","FINAL"]'
 WHERE slug = 'fifa-world-cup-2026';

ALTER TABLE matches ADD COLUMN duration TEXT;
ALTER TABLE matches ADD COLUMN penalty_winner TEXT CHECK (penalty_winner IN ('home', 'away'));
ALTER TABLE matches ADD COLUMN home_penalty_goals INTEGER;
ALTER TABLE matches ADD COLUMN away_penalty_goals INTEGER;

-- predictions: vencedor dos pênaltis palpitado + bônus à parte do base (points_awarded).
ALTER TABLE predictions ADD COLUMN predicted_penalty_winner TEXT CHECK (predicted_penalty_winner IN ('home', 'away'));
ALTER TABLE predictions ADD COLUMN penalty_points INTEGER NOT NULL DEFAULT 0;

-- groups: bônus configurável por grupo (0 desliga). Aditivo, não entra na regra
-- points_exact >= points_winner.
ALTER TABLE groups ADD COLUMN points_penalty INTEGER NOT NULL DEFAULT 1 CHECK (points_penalty BETWEEN 0 AND 10);
