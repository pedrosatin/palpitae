-- Seed da Serie A Italiana 2026 via football-data SA/2019, visibility pilot.
-- API name "Serie A" já gera slug serie-a-2026 via slugify. Sem COMP_SLUG_OVERRIDES.
-- Nome de exibição PT via COMP_TRANSLATIONS ('Serie A' → 'Serie A Italiana').
INSERT INTO competitions (
  id,
  name,
  slug,
  external_id,
  provider,
  season,
  status,
  type,
  penalty_phases,
  visibility
)
VALUES (
  '20190000-0000-4000-8000-000000002026',
  'Serie A Italiana',
  'serie-a-2026',
  '2019',
  'football-data',
  '2026',
  'ongoing',
  'league',
  '[]',
  'pilot'
)
ON CONFLICT (slug) DO UPDATE SET
  name           = excluded.name,
  external_id    = excluded.external_id,
  provider       = excluded.provider,
  season         = excluded.season,
  status         = excluded.status,
  type           = excluded.type,
  penalty_phases = excluded.penalty_phases,
  visibility     = excluded.visibility;
