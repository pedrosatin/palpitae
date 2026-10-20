-- Seed do Championship 2026 via football-data ELC/2016, visibility pilot.
-- API name "Championship" já gera slug championship-2026 via slugify. Sem COMP_SLUG_OVERRIDES.
-- Nenhuma chave de COMP_TRANSLATIONS casa "Championship" via includes(), então o nome fica como vem da API.
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
  '20160000-0000-4000-8000-000000002026',
  'Championship',
  'championship-2026',
  '2016',
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
