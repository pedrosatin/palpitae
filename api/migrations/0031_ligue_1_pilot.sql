-- Seed da Ligue 1 2026 via football-data FL1/2015, visibility pilot.
-- API name "Ligue 1" já gera slug ligue-1-2026 via slugify. Sem COMP_SLUG_OVERRIDES.
-- Nenhuma chave de COMP_TRANSLATIONS casa "Ligue 1" via includes(), então o nome fica como vem da API.
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
  '20150000-0000-4000-8000-000000002026',
  'Ligue 1',
  'ligue-1-2026',
  '2015',
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
