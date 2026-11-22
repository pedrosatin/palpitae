CREATE UNIQUE INDEX IF NOT EXISTS idx_competitions_provider_external_season
  ON competitions(provider, external_id, season);
