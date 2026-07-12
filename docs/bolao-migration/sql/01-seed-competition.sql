-- Fase 1 — Seed do Brasileirão Série A 2026 (só a linha da competição).
-- Times e partidas serão populados pelo cron diário de fixture discovery (06h UTC),
-- que seleciona provider='football-data' AND status != 'finished' e roda o
-- syncFixtures de produção (idempotente).
--
-- O slug PRECISA ser exatamente o que slugify() derivaria do nome cru da API
-- ("Campeonato Brasileiro Série A" + season) — é a chave de conflito do upsert do
-- sync; qualquer outro valor criaria competição duplicada no primeiro re-sync.
-- O nome de exibição é livre (ON CONFLICT não atualiza name).
--
-- Aplicar com:
--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/01-seed-competition.sql

INSERT INTO competitions (id, name, slug, external_id, provider, season, status, penalty_phases)
VALUES (
  '06baa1de-01c3-4e71-ac6e-a850fa690ec1',
  'Brasileirão Série A',
  'campeonato-brasileiro-serie-a-2026',
  '2013',
  'football-data',
  '2026',
  'ongoing',
  '[]'  -- liga: nunca vai a pênaltis (gate fail-closed)
);
