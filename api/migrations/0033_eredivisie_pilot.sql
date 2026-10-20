-- Seed da Eredivisie 2026 via football-data DED/2003, visibility pilot.
-- API name "Eredivisie" já gera slug eredivisie-2026 via slugify. Sem COMP_SLUG_OVERRIDES.
-- Nenhuma chave de COMP_TRANSLATIONS casa "Eredivisie" via includes(), então o nome fica como vem da API.
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
  '20030000-0000-4000-8000-000000002026',
  'Eredivisie',
  'eredivisie-2026',
  '2003',
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
