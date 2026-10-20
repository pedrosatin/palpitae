-- Seed da La Liga 2026 (football-data PD / 2014) com visibilidade de piloto.
-- O slug de produto (la-liga-2026) diverge do nome cru da API (Primera Division);
-- sync.ts tem COMP_SLUG_OVERRIDES para o upsert achar esta linha.
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
  '20140000-0000-4000-8000-000000002026',
  'La Liga',
  'la-liga-2026',
  '2014',
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
