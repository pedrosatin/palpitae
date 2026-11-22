
ALTER TABLE competitions ADD COLUMN matches_version INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS matches_version_insert AFTER INSERT ON matches
BEGIN
  UPDATE competitions SET matches_version = matches_version + 1 WHERE id = NEW.competition_id;
END;

CREATE TRIGGER IF NOT EXISTS matches_version_update AFTER UPDATE ON matches
WHEN NEW.competition_id IS NOT OLD.competition_id
  OR NEW.home_team_id IS NOT OLD.home_team_id
  OR NEW.away_team_id IS NOT OLD.away_team_id
  OR NEW.start_time IS NOT OLD.start_time
  OR NEW.status IS NOT OLD.status
  OR NEW.postponed IS NOT OLD.postponed
  OR NEW.locked_at IS NOT OLD.locked_at
  OR NEW.home_score IS NOT OLD.home_score
  OR NEW.away_score IS NOT OLD.away_score
  OR NEW.phase IS NOT OLD.phase
  OR NEW.round IS NOT OLD.round
  OR NEW.group_name IS NOT OLD.group_name
  OR NEW.leg IS NOT OLD.leg
  OR NEW.duration IS NOT OLD.duration
  OR NEW.penalty_winner IS NOT OLD.penalty_winner
  OR NEW.home_penalty_goals IS NOT OLD.home_penalty_goals
  OR NEW.away_penalty_goals IS NOT OLD.away_penalty_goals
BEGIN
  UPDATE competitions SET matches_version = matches_version + 1
   WHERE id = NEW.competition_id OR id = OLD.competition_id;
END;

CREATE TRIGGER IF NOT EXISTS matches_version_delete AFTER DELETE ON matches
BEGIN
  UPDATE competitions SET matches_version = matches_version + 1 WHERE id = OLD.competition_id;
END;

CREATE TRIGGER IF NOT EXISTS matches_version_team AFTER UPDATE ON teams
WHEN NEW.name IS NOT OLD.name OR NEW.short_name IS NOT OLD.short_name OR NEW.logo_url IS NOT OLD.logo_url
BEGIN
  UPDATE competitions SET matches_version = matches_version + 1 WHERE id IN (
    SELECT competition_id FROM matches WHERE home_team_id = NEW.id OR away_team_id = NEW.id
  );
END;

CREATE TRIGGER IF NOT EXISTS matches_version_rules AFTER UPDATE OF penalty_phases ON competitions
WHEN NEW.penalty_phases IS NOT OLD.penalty_phases
BEGIN
  UPDATE competitions SET matches_version = matches_version + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS matches_distinct_teams_insert BEFORE INSERT ON matches
WHEN NEW.home_team_id = NEW.away_team_id
BEGIN
  SELECT RAISE(ABORT, 'matches: mandante igual ao visitante');
END;

CREATE TRIGGER IF NOT EXISTS matches_distinct_teams_update BEFORE UPDATE OF home_team_id, away_team_id ON matches
WHEN NEW.home_team_id = NEW.away_team_id
BEGIN
  SELECT RAISE(ABORT, 'matches: mandante igual ao visitante');
END;

CREATE TRIGGER IF NOT EXISTS matches_rescore_context AFTER UPDATE OF home_team_id, away_team_id, phase, leg, start_time ON matches
WHEN NEW.home_team_id IS NOT OLD.home_team_id OR NEW.away_team_id IS NOT OLD.away_team_id
  OR NEW.phase IS NOT OLD.phase OR NEW.leg IS NOT OLD.leg OR NEW.start_time IS NOT OLD.start_time
BEGIN
  UPDATE matches SET scored_at = NULL
   WHERE scored_at IS NOT NULL AND (
     id = NEW.id OR
     (competition_id = OLD.competition_id AND phase IS OLD.phase
       AND phase IN (
         'FIRST_STAGE', 'SECOND_STAGE', 'THIRD_STAGE', 'FIRST_ROUND', 'SECOND_ROUND', 'THIRD_ROUND',
         'FOURTH_ROUND', 'FIFTH_ROUND', 'PLAYOFFS', 'LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS',
         'THIRD_PLACE', 'FINAL', 'TACA_GUANABARA_QUARTER_FINALS', 'TACA_GUANABARA_SEMI_FINALS',
         'TACA_GUANABARA_FINAL', 'TACA_RIO_SEMI_FINALS', 'TACA_RIO_FINAL', 'TROFEU_INCONFIDENCIA_SEMI_FINALS',
         'TROFEU_INCONFIDENCIA_FINAL', 'PLAYOFFS_SEMI_FINALS', 'PLAYOFFS_FINAL', 'FARROUPILHA_SEMI_FINALS',
         'FARROUPILHA_FINAL'
       )
       AND home_team_id = OLD.away_team_id AND away_team_id = OLD.home_team_id) OR
     (competition_id = NEW.competition_id AND phase IS NEW.phase
       AND phase IN (
         'FIRST_STAGE', 'SECOND_STAGE', 'THIRD_STAGE', 'FIRST_ROUND', 'SECOND_ROUND', 'THIRD_ROUND',
         'FOURTH_ROUND', 'FIFTH_ROUND', 'PLAYOFFS', 'LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS',
         'THIRD_PLACE', 'FINAL', 'TACA_GUANABARA_QUARTER_FINALS', 'TACA_GUANABARA_SEMI_FINALS',
         'TACA_GUANABARA_FINAL', 'TACA_RIO_SEMI_FINALS', 'TACA_RIO_FINAL', 'TROFEU_INCONFIDENCIA_SEMI_FINALS',
         'TROFEU_INCONFIDENCIA_FINAL', 'PLAYOFFS_SEMI_FINALS', 'PLAYOFFS_FINAL', 'FARROUPILHA_SEMI_FINALS',
         'FARROUPILHA_FINAL'
       )
       AND home_team_id = NEW.away_team_id AND away_team_id = NEW.home_team_id)
   );
END;
