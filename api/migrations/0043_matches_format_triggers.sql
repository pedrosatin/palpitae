CREATE TRIGGER IF NOT EXISTS matches_format_insert
BEFORE INSERT ON matches
BEGIN
  SELECT RAISE(ABORT, 'matches.start_time fora do formato YYYY-MM-DDTHH:MM:SSZ')
   WHERE strftime('%Y-%m-%dT%H:%M:%SZ', NEW.start_time) IS NOT NEW.start_time;
  SELECT RAISE(ABORT, 'matches: jogo finished sem placar')
   WHERE NEW.status = 'finished' AND (NEW.home_score IS NULL OR NEW.away_score IS NULL);
  SELECT RAISE(ABORT, 'matches.round nulo')
   WHERE NEW.round IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS matches_format_update
BEFORE UPDATE OF start_time, status, home_score, away_score, round ON matches
BEGIN
  SELECT RAISE(ABORT, 'matches.start_time fora do formato YYYY-MM-DDTHH:MM:SSZ')
   WHERE NEW.start_time IS NOT OLD.start_time
     AND strftime('%Y-%m-%dT%H:%M:%SZ', NEW.start_time) IS NOT NEW.start_time;
  SELECT RAISE(ABORT, 'matches: jogo finished sem placar')
   WHERE NEW.status = 'finished' AND (NEW.home_score IS NULL OR NEW.away_score IS NULL)
     AND (OLD.status IS NOT 'finished'
          OR NEW.home_score IS NOT OLD.home_score
          OR NEW.away_score IS NOT OLD.away_score);
  SELECT RAISE(ABORT, 'matches.round nulo')
   WHERE NEW.round IS NULL AND OLD.round IS NOT NULL;
END;
