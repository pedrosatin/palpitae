-- Pênaltis no mata-mata: palpite do vencedor dos pênaltis + bônus de pontuação.
-- Gate data-driven por (competição, fase): só pede/pontua pênalti nas fases listadas
-- em competitions.penalty_phases. Comp sem entrada ('[]') = fail-closed (nunca pênalti).

-- Fonte de verdade do gate: JSON array das fases (stage) que vão a pênalti em jogo único.
ALTER TABLE competitions ADD COLUMN penalty_phases TEXT NOT NULL DEFAULT '[]';

-- Seed da Copa do Mundo 2026 (slug confirmado no prod DB).
UPDATE competitions
   SET penalty_phases = '["LAST_16","QUARTER_FINALS","SEMI_FINALS","THIRD_PLACE","FINAL"]'
 WHERE slug = 'fifa-world-cup-2026';

-- matches: duração da partida + dados dos pênaltis (NULL quando não houve).
-- home_score/away_score passam a guardar o placar canônico (reg+ET); os gols de
-- pênalti ficam à parte p/ display "1-1 (5-4 pênaltis)".
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
