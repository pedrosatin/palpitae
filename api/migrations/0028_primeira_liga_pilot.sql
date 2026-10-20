-- Seed da Primeira Liga 2026 via football-data PPL/2017, visibility pilot.
-- API name "Primeira Liga" já gera slug primeira-liga-2026 via slugify. Sem COMP_SLUG_OVERRIDES.
-- Não confundir com "Primera Division" (La Liga): includes() da chave espanhola não casa "Primeira Liga".
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
  '20170000-0000-4000-8000-000000002026',
  'Primeira Liga',
  'primeira-liga-2026',
  '2017',
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
