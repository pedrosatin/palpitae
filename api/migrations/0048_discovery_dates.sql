-- Evidência agregada das nove datas de uma descoberta adiada.
-- NULL significa data ainda não concluída; zero confirma ausência de times indefinidos.
CREATE TABLE discovery_dates (
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  window_start TEXT NOT NULL,
  date TEXT NOT NULL,
  discarded_tbd INTEGER,
  PRIMARY KEY (competition_id, window_start, date)
);
