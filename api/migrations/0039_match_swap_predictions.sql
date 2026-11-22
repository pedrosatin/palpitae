CREATE TRIGGER IF NOT EXISTS matches_swap_predictions
AFTER UPDATE OF home_team_id, away_team_id ON matches
WHEN NEW.home_team_id = OLD.away_team_id AND NEW.away_team_id = OLD.home_team_id
BEGIN
  UPDATE predictions
     SET predicted_home_score = predicted_away_score,
         predicted_away_score = predicted_home_score,
         predicted_penalty_winner = CASE predicted_penalty_winner
                                      WHEN 'home' THEN 'away'
                                      WHEN 'away' THEN 'home'
                                    END
   WHERE match_id = NEW.id;
END;
