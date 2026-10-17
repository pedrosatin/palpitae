-- Seed da Copa Sul-Americana 2026 com a ESPN como provider primário e visibilidade de piloto.
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
  '07990000-0000-4000-8000-000000002026',
  'Copa Sul-Americana',
  'conmebol-sudamericana-2026',
  'conmebol.sudamericana',
  'espn',
  '2026',
  'ongoing',
  'cup',
  '["FIRST_STAGE","PLAYOFFS","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINAL"]',
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
