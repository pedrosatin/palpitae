-- Seed da Liga dos Campeões e da Premier League na temporada 2026.
-- A Liga dos Campeões usa formato de copa com pênaltis apenas na final em jogo único.
-- A Premier League é pontos corridos e exibe a aba de classificação sem fases de pênaltis.
INSERT INTO competitions (id, name, slug, external_id, provider, season, status, type, penalty_phases)
VALUES
  ('20010000-0000-4000-8000-000000002026', 'Liga dos Campeões', 'uefa-champions-league-2026', '2001', 'football-data', '2026', 'ongoing', 'cup', '["FINAL"]'),
  ('20210000-0000-4000-8000-000000002026', 'Premier League', 'premier-league-2026', '2021', 'football-data', '2026', 'ongoing', 'league', '[]')
ON CONFLICT (slug) DO UPDATE SET
  name           = excluded.name,
  external_id    = excluded.external_id,
  type           = excluded.type,
  penalty_phases = excluded.penalty_phases,
  status         = excluded.status;
