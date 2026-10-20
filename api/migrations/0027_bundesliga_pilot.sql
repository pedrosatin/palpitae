-- Seed da Bundesliga 2026 via football-data BL1/2002, visibility pilot.
-- API name "Bundesliga" já gera slug bundesliga-2026 via slugify. Sem COMP_SLUG_OVERRIDES.
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
  '20020000-0000-4000-8000-000000002026',
  'Bundesliga',
  'bundesliga-2026',
  '2002',
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
