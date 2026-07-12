-- Fase 1b — Seed de times + jogos do BSA 2026 (gerado por generate-seed-matches.mjs; não editar à mão).
-- Idempotente e compatível com o upsert do syncFixtures (mesmas chaves de conflito).
-- Aplicar com:
--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/01b-seed-teams-matches.sql

INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('8610ac1b-4b4b-4b5d-90f2-eba8bd423bc0', 'CA Mineiro', 'CAM', 'ca-mineiro', 'https://crests.football-data.org/1766.png', '1766', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('d401f6ff-dad8-4a55-9a05-a98b4bcfd6a9', 'SE Palmeiras', 'PAL', 'se-palmeiras', 'https://crests.football-data.org/1769.png', '1769', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('5b34a61b-c704-4053-b57e-3ee0c305e909', 'Coritiba FBC', 'COR', 'coritiba-fbc', 'https://crests.football-data.org/4241.png', '4241', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('af8b6d32-d0eb-49d8-8a13-81e87eedf825', 'RB Bragantino', 'RBB', 'rb-bragantino', 'https://crests.football-data.org/4286.png', '4286', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('fc5bfe6d-a9c7-4697-8fca-8519cf5ade4f', 'SC Internacional', 'SCI', 'sc-internacional', 'https://crests.football-data.org/6684.png', '6684', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('7f9664d9-75ee-4652-932c-5b6d8eb43857', 'CA Paranaense', 'CAP', 'ca-paranaense', 'https://crests.football-data.org/1768.png', '1768', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('a37e5758-ec06-4b5e-90a3-632b49f8d6ae', 'EC Vitória', 'VIT', 'ec-vitoria', 'https://crests.football-data.org/1782.png', '1782', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('69db55b5-33ee-4423-9ba2-f8140fee2146', 'Clube do Remo', 'CRE', 'clube-do-remo', 'https://crests.football-data.org/4287.png', '4287', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('8ed85095-2ce6-4dde-b2f2-5944b1680623', 'Fluminense FC', 'FLU', 'fluminense-fc', 'https://crests.football-data.org/1765.png', '1765', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('478541c5-a423-465e-8993-f4b33dd352cd', 'Grêmio FBPA', 'FBP', 'gremio-fbpa', 'https://crests.football-data.org/1767.png', '1767', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('07bce4bd-6d17-4f1d-9db7-cfc76f4c412e', 'Chapecoense AF', 'CHA', 'chapecoense-af', 'https://crests.football-data.org/1772_large.png', '1772', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('28c01f6b-5840-411d-8b31-87e480c5c1c8', 'Santos FC', 'SAN', 'santos-fc', 'https://crests.football-data.org/6685.png', '6685', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('95337372-2430-4f9b-97c2-710f79500e98', 'SC Corinthians Paulista', 'COR', 'sc-corinthians-paulista', 'https://crests.football-data.org/1779.png', '1779', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('d7f977be-f2a0-4fba-8259-aad695b60400', 'EC Bahia', 'BAH', 'ec-bahia', 'https://crests.football-data.org/1777.png', '1777', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('e94f7adc-ec7d-43db-bd1a-53963845f216', 'São Paulo FC', 'PAU', 'sao-paulo-fc', 'https://crests.football-data.org/1776.png', '1776', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('0412a383-742c-4690-80d2-84f4ffcd7980', 'CR Flamengo', 'FLA', 'cr-flamengo', 'https://crests.football-data.org/1783.png', '1783', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('80e9e5a2-bb91-4fec-97de-065bdb0decbb', 'Mirassol FC', 'MIR', 'mirassol-fc', 'https://crests.football-data.org/4364.png', '4364', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('b50b5800-fc9c-41fd-b6a8-128c8cf5ed9c', 'CR Vasco da Gama', 'VAS', 'cr-vasco-da-gama', 'https://crests.football-data.org/1780.png', '1780', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('a0cb1d47-536a-4136-b1d7-9f1cec5df487', 'Botafogo FR', 'BOT', 'botafogo-fr', 'https://crests.football-data.org/1770.png', '1770', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;
INSERT INTO teams (id, name, short_name, slug, logo_url, external_id, provider)
VALUES ('27ad7edd-501c-45fd-8826-8b9039d905bf', 'Cruzeiro EC', 'CRU', 'cruzeiro-ec', 'https://crests.football-data.org/1771.png', '1771', 'football-data')
ON CONFLICT (external_id, provider) DO UPDATE SET logo_url = excluded.logo_url;

INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a3d7a504-7ac4-46ec-bc20-22a461376510', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554740', 'football-data', h.id, a.id, '2026-01-28T22:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8c1c2904-1fa6-4f61-b8ba-1143ca87b60c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554744', 'football-data', h.id, a.id, '2026-01-28T22:00:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '523850b1-2b7d-4857-abc2-0fd1c996715a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554746', 'football-data', h.id, a.id, '2026-01-28T22:00:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c2fdf8f6-2854-495d-b855-1e8d66d1d333', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554749', 'football-data', h.id, a.id, '2026-01-28T22:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ed26a6db-6d4e-4999-907a-175613ef90c4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554745', 'football-data', h.id, a.id, '2026-01-28T22:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e8ec132b-9d76-4e68-b8d6-d5fcc2c79b2f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554742', 'football-data', h.id, a.id, '2026-01-28T23:00:00Z', 'finished', 4, 2, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0405cb52-c7d9-4ce0-9f55-706fe18c5123', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554743', 'football-data', h.id, a.id, '2026-01-28T23:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e7fee540-afdc-49d2-b113-9c0c753013bc', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554748', 'football-data', h.id, a.id, '2026-01-29T00:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9e49bfc6-7971-4e0d-b0c6-1712d33a4a9f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554747', 'football-data', h.id, a.id, '2026-01-29T23:00:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a6c230f8-b9b4-46ac-be68-7122207e07b8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554741', 'football-data', h.id, a.id, '2026-01-30T00:30:00Z', 'finished', 4, 0, 'REGULAR_SEASON', '1', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ad013e3b-5e85-4e4f-a662-b58ae005ea8e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554752', 'football-data', h.id, a.id, '2026-02-04T22:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e1733c5c-0385-482c-a6b0-8c207a726573', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554754', 'football-data', h.id, a.id, '2026-02-04T22:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ae02056b-6aaf-4671-bc3d-4cebfe153d99', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554757', 'football-data', h.id, a.id, '2026-02-04T23:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '97496b4c-ac0a-4c18-a4c0-b4a0a7f52f71', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554758', 'football-data', h.id, a.id, '2026-02-04T23:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9df8bd5a-edaf-41ed-82cf-66e8ddcc7bf1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554755', 'football-data', h.id, a.id, '2026-02-05T00:30:00Z', 'finished', 5, 3, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6f9e06a0-b366-4cec-a0cf-e7eac0e86e09', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554756', 'football-data', h.id, a.id, '2026-02-05T00:30:00Z', 'finished', 5, 1, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5341bff9-c76e-43c5-8b8c-d698f92868b3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554751', 'football-data', h.id, a.id, '2026-02-05T22:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8702110b-2ff6-415e-850c-3e167f93603c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554759', 'football-data', h.id, a.id, '2026-02-05T23:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '11f2682f-d55a-4368-987e-93ceff856556', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554753', 'football-data', h.id, a.id, '2026-02-06T00:30:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1e36fbef-8b6b-430e-a4fc-f960e1cb9c21', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554769', 'football-data', h.id, a.id, '2026-02-11T00:30:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9f585d4c-4849-4b70-8538-760fda26b5dc', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554762', 'football-data', h.id, a.id, '2026-02-11T22:00:00Z', 'finished', 3, 3, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6806f9a4-8539-4f48-95b3-42a97d292106', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554766', 'football-data', h.id, a.id, '2026-02-11T22:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '83ce6ab3-ca47-48fc-8ae7-c24364a27719', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554761', 'football-data', h.id, a.id, '2026-02-11T23:00:00Z', 'finished', 3, 3, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'dfe1f05d-7bec-4b1b-ba9e-4275ac081da5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554767', 'football-data', h.id, a.id, '2026-02-12T00:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd24bdecf-7699-4741-bf76-6c3c8cdb02e5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554768', 'football-data', h.id, a.id, '2026-02-12T00:30:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '4f543198-e339-4571-b760-abd8d4f9637d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554760', 'football-data', h.id, a.id, '2026-02-12T22:00:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '37e0281a-5aee-474f-9a1d-5771a36ba99f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554764', 'football-data', h.id, a.id, '2026-02-12T22:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '332e25d8-d8e0-4000-b682-759fff26f6ca', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554763', 'football-data', h.id, a.id, '2026-02-12T23:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '015e527f-f092-4fbb-84f2-446e0fffd91a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554765', 'football-data', h.id, a.id, '2026-02-13T00:30:00Z', 'finished', 1, 3, 'REGULAR_SEASON', '3', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'cc23165d-af42-4305-81ad-2c948ce68ab2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554750', 'football-data', h.id, a.id, '2026-02-19T22:30:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '2', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '78cdd726-6d59-43e4-b5b8-a9944a059363', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554775', 'football-data', h.id, a.id, '2026-02-25T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '914bf253-9af7-47de-a78e-9a054031b287', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554772', 'football-data', h.id, a.id, '2026-02-25T22:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a07c3d6a-38ad-4594-94b5-3c212f4559b3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554778', 'football-data', h.id, a.id, '2026-02-25T22:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '47b46670-dc30-4b2c-b075-80b9f6bbc34c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554773', 'football-data', h.id, a.id, '2026-02-25T22:30:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a0b0961a-cdae-4d07-8488-7d1ff301522d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554774', 'football-data', h.id, a.id, '2026-02-25T23:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '25282bec-6f30-4e52-8e87-9c9c23ec6e90', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554776', 'football-data', h.id, a.id, '2026-02-26T00:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '4b93476a-ad5e-44a6-be89-0f26fc2eda1e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554777', 'football-data', h.id, a.id, '2026-02-26T00:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9a76ee5a-060d-4330-a523-e5c40d3d10ae', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554779', 'football-data', h.id, a.id, '2026-02-26T22:00:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a53b20c1-395f-4140-bc39-b584f009c0af', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554786', 'football-data', h.id, a.id, '2026-03-11T00:30:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6feffc65-7a9d-4fdf-9957-93989b30c31a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554781', 'football-data', h.id, a.id, '2026-03-11T22:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '21385625-dc92-4f39-bf3f-dcfc617db03f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554782', 'football-data', h.id, a.id, '2026-03-11T23:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a7bdf822-1883-4400-a627-765705ae0273', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554783', 'football-data', h.id, a.id, '2026-03-12T00:30:00Z', 'finished', 0, 2, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'fcd4fb5d-f231-4011-8e1e-f6ea86437d26', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554784', 'football-data', h.id, a.id, '2026-03-12T00:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6ab225ad-62bd-47be-92e8-e689a136d7a0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554787', 'football-data', h.id, a.id, '2026-03-12T22:00:00Z', 'finished', 0, 2, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0b62e799-f055-4de7-b02d-187960f37de2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554789', 'football-data', h.id, a.id, '2026-03-12T22:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a7c91379-0f6a-446b-b692-1d2b8c00e7ab', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554788', 'football-data', h.id, a.id, '2026-03-12T23:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1bf4e544-a553-4b3b-b7b4-1188b291fa80', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554785', 'football-data', h.id, a.id, '2026-03-13T00:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '675c9269-5f16-4986-8a03-5f5cdfac6fe3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554799', 'football-data', h.id, a.id, '2026-03-14T21:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a38a80b4-48b2-44f0-ab35-4a7d6e717839', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554790', 'football-data', h.id, a.id, '2026-03-14T23:30:00Z', 'finished', 0, 3, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a74f8934-f89f-4e31-acd5-cf5affd5fc6e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554795', 'football-data', h.id, a.id, '2026-03-15T19:00:00Z', 'finished', 3, 2, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '2966f93f-047a-46a0-ade8-59fd1801196d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554796', 'football-data', h.id, a.id, '2026-03-15T19:00:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ff58b5f7-9f85-4445-8d22-938350c66375', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554798', 'football-data', h.id, a.id, '2026-03-15T19:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a31b6218-3b0d-4954-8590-1baf6c8d64ad', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554793', 'football-data', h.id, a.id, '2026-03-15T21:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8d1147e5-244d-4ea6-9601-06fae1d28c75', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554797', 'football-data', h.id, a.id, '2026-03-15T21:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8c3a6ec3-7dbf-400b-bce6-7f5808a17e2f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554791', 'football-data', h.id, a.id, '2026-03-15T23:30:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '47ce91fe-d166-4750-8116-ee8d420f8f56', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554794', 'football-data', h.id, a.id, '2026-03-15T23:30:00Z', 'finished', 3, 3, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '96d2eed9-5ea5-465e-a1ce-f1430089ad23', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554792', 'football-data', h.id, a.id, '2026-03-16T23:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '6', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6c89f5a1-7296-4e67-b601-9d70e949eb56', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554802', 'football-data', h.id, a.id, '2026-03-18T22:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7baf1617-ad9e-4c60-8fc6-db8fce15b8bf', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554807', 'football-data', h.id, a.id, '2026-03-18T22:00:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8a7931f3-7cc2-4387-a286-d9841b288442', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554800', 'football-data', h.id, a.id, '2026-03-18T22:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7c1898d1-3aa6-4313-a619-89a6e12e00c8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554801', 'football-data', h.id, a.id, '2026-03-18T23:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '95d916aa-5d08-4404-84ac-9128092366f4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554806', 'football-data', h.id, a.id, '2026-03-18T23:00:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '546d2856-9b3a-4d03-ad0c-f5bf867c31fe', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554808', 'football-data', h.id, a.id, '2026-03-19T00:30:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7fef3188-ecd9-47b7-9514-93a1acce70e5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554809', 'football-data', h.id, a.id, '2026-03-19T00:30:00Z', 'finished', 3, 2, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '445d08ef-83c3-4d09-8701-03b36f3df3af', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554805', 'football-data', h.id, a.id, '2026-03-19T22:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ecae73b8-d5ae-493b-b2b7-23bb368bada0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554804', 'football-data', h.id, a.id, '2026-03-19T23:00:00Z', 'finished', 3, 0, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'bcfa82ae-5c94-448c-9960-1b3995cf2fdf', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554803', 'football-data', h.id, a.id, '2026-03-20T00:30:00Z', 'finished', 0, 0, 'REGULAR_SEASON', '7', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '30327ebe-dfc8-4ec4-82ff-f9f41d022657', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554811', 'football-data', h.id, a.id, '2026-03-21T19:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '64345464-c88e-44d1-99c2-f03d7611d4d3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554814', 'football-data', h.id, a.id, '2026-03-21T21:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '810d13e5-7ff4-494e-b9ea-78467703a172', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554817', 'football-data', h.id, a.id, '2026-03-22T00:00:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '21f1b557-0632-4539-8db2-2341fc57b9f8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554810', 'football-data', h.id, a.id, '2026-03-22T19:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8842a185-fbb5-41f4-814d-ab238e84b382', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554813', 'football-data', h.id, a.id, '2026-03-22T19:00:00Z', 'finished', 0, 0, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '864d1b21-cc8b-4505-bd47-6844582ab4d1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554816', 'football-data', h.id, a.id, '2026-03-22T19:00:00Z', 'finished', 4, 1, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ac3fe889-4ce9-495d-801f-9403548786b2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554818', 'football-data', h.id, a.id, '2026-03-22T19:00:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a2e9d1d5-a1a1-4b82-8f54-9c257e040eb2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554815', 'football-data', h.id, a.id, '2026-03-22T21:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ad5cd3ee-6c00-4132-872b-f231e5230b64', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554819', 'football-data', h.id, a.id, '2026-03-22T21:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ff64d919-24b6-4790-9a3b-1e4e6083ca34', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554812', 'football-data', h.id, a.id, '2026-03-22T23:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '8', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e3b6076c-6a43-4e80-b0a8-2cc435066b1e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554780', 'football-data', h.id, a.id, '2026-03-29T22:30:00Z', 'finished', 4, 1, 'REGULAR_SEASON', '5', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c020ef8d-2e92-4cb6-b1cf-90ce39d6b93e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554821', 'football-data', h.id, a.id, '2026-04-01T22:30:00Z', 'finished', 3, 2, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7592daf9-2e94-4b67-abb7-4be6f7231856', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554827', 'football-data', h.id, a.id, '2026-04-01T22:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b816d215-9563-4ca3-aecd-b2a90c0b0187', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554820', 'football-data', h.id, a.id, '2026-04-01T23:00:00Z', 'finished', 3, 0, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7145eebd-1a41-4c06-b8c6-7a71738f53a9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554825', 'football-data', h.id, a.id, '2026-04-01T23:00:00Z', 'finished', 3, 0, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ac352e55-36d1-4d29-8d51-cf846653034f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554824', 'football-data', h.id, a.id, '2026-04-01T23:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '240c8a53-4d4e-47b5-9796-8b0caf6aa13b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554826', 'football-data', h.id, a.id, '2026-04-02T00:30:00Z', 'finished', 3, 1, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a4d28622-25e4-4eaa-8e41-92e24ab53eab', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554823', 'football-data', h.id, a.id, '2026-04-02T22:00:00Z', 'finished', 0, 4, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3b727836-4533-4387-ae0f-9eee32081d96', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554829', 'football-data', h.id, a.id, '2026-04-02T22:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'aadf50d2-9abc-4a0f-80d3-38eb92e08d2c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554822', 'football-data', h.id, a.id, '2026-04-03T00:30:00Z', 'finished', 3, 0, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e638a51e-a643-4110-a2b1-758808046eb1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554828', 'football-data', h.id, a.id, '2026-04-03T00:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '9', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '740e4de6-2862-4339-8730-48f27327ca02', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554838', 'football-data', h.id, a.id, '2026-04-04T21:30:00Z', 'finished', 4, 1, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5e14ddd5-87db-4656-adce-602bc4f4abd2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554834', 'football-data', h.id, a.id, '2026-04-04T23:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '800ee43f-cee4-4777-84f0-57473e97fe83', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554839', 'football-data', h.id, a.id, '2026-04-05T00:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '08ee5702-561c-4f27-bb31-f4afda9d3307', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554832', 'football-data', h.id, a.id, '2026-04-05T19:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3b401e02-5684-42aa-b094-6e6a3bca19a8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554830', 'football-data', h.id, a.id, '2026-04-05T20:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '312af77c-4ac7-4faa-a1be-2bc058ad8411', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554835', 'football-data', h.id, a.id, '2026-04-05T20:30:00Z', 'finished', 3, 1, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '77a30621-aea5-40e7-8960-e56a32065093', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554831', 'football-data', h.id, a.id, '2026-04-05T22:30:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3ee0bf75-1625-4916-88f2-790e2ce83c25', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554833', 'football-data', h.id, a.id, '2026-04-05T22:30:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd61fefb6-156a-4a77-99a4-d61c773f2275', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554837', 'football-data', h.id, a.id, '2026-04-05T23:00:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'fe4ff70f-bfab-4f4f-89dc-328e5ed9c9bb', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554836', 'football-data', h.id, a.id, '2026-04-05T23:30:00Z', 'finished', 0, 0, 'REGULAR_SEASON', '10', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9536d64c-bdac-4fa2-aa2a-3bc6513e1e23', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554847', 'football-data', h.id, a.id, '2026-04-11T19:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '78ee45d8-3e75-4116-8a72-b0a963967481', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554849', 'football-data', h.id, a.id, '2026-04-11T19:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f0ee48a4-7090-4b39-b94f-26547c1f772b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554846', 'football-data', h.id, a.id, '2026-04-11T21:30:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '39fecda5-94b1-44c8-8a08-858cc5949a1c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554848', 'football-data', h.id, a.id, '2026-04-11T23:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '331164ea-aecb-4b27-9851-5af850e69c72', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554845', 'football-data', h.id, a.id, '2026-04-11T23:30:00Z', 'finished', 0, 0, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '92a83925-ec0b-4971-bb43-975345fc6e54', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554840', 'football-data', h.id, a.id, '2026-04-12T14:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7708cacb-b83e-40e5-b30f-cf42d5f5df48', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554841', 'football-data', h.id, a.id, '2026-04-12T19:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f3fdd6de-7cc5-4fd1-bd59-250af88bf574', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554844', 'football-data', h.id, a.id, '2026-04-12T21:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '93b4d4ee-4116-4260-8120-0a08f6b9d855', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554842', 'football-data', h.id, a.id, '2026-04-12T21:30:00Z', 'finished', 0, 0, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '88760c4d-4eb5-427c-9c5b-422357a8d321', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554843', 'football-data', h.id, a.id, '2026-04-12T21:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '11', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9f912a34-c9a8-4e5c-ad61-40b33d4c1270', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554851', 'football-data', h.id, a.id, '2026-04-18T21:30:00Z', 'finished', 1, 4, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd906170a-c19f-4ace-bc38-9e68db109469', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554858', 'football-data', h.id, a.id, '2026-04-18T21:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8c90e124-1a2e-4cc7-9fe9-34eaed81a30a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554859', 'football-data', h.id, a.id, '2026-04-18T23:00:00Z', 'finished', 0, 0, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'add9bea9-cf00-4b7f-95e6-f36357629bb5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554853', 'football-data', h.id, a.id, '2026-04-18T23:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e9192817-6a5e-44a0-beaa-57ba9eafd3a4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554855', 'football-data', h.id, a.id, '2026-04-19T14:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3a80ec9b-8cf3-40cd-a7ee-3e8b614d6c59', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554852', 'football-data', h.id, a.id, '2026-04-19T19:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6c8a8e49-9874-46f2-a4b0-a1d7e4490336', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554857', 'football-data', h.id, a.id, '2026-04-19T19:00:00Z', 'finished', 2, 3, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '43e3d81b-46b7-4241-9153-bae54b8dc2fb', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554850', 'football-data', h.id, a.id, '2026-04-19T21:30:00Z', 'finished', 4, 2, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6562491d-ed55-4353-a3d2-6b1904ce465d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554856', 'football-data', h.id, a.id, '2026-04-19T21:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd2034ce3-a947-419b-a686-2abe411eb730', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554854', 'football-data', h.id, a.id, '2026-04-19T22:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '12', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0296671e-6d78-456b-9095-6cbd767192e6', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554862', 'football-data', h.id, a.id, '2026-04-25T21:30:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0372dd49-7ca6-41d1-928c-ef6fd3242a37', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554863', 'football-data', h.id, a.id, '2026-04-25T21:30:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8584b7e1-121f-41a4-b947-a438fc6944c7', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554868', 'football-data', h.id, a.id, '2026-04-25T21:30:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b1b693b0-cae1-4c95-85d2-c07bb9191cc4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554869', 'football-data', h.id, a.id, '2026-04-26T00:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c3c3940c-c523-4b80-a3b5-4278eb6009ae', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554865', 'football-data', h.id, a.id, '2026-04-26T19:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '93a8c8fa-bd63-4e88-bb91-b9fee1f7d494', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554867', 'football-data', h.id, a.id, '2026-04-26T19:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '61c2ea60-ca13-41b5-aa71-a0c75d997d52', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554860', 'football-data', h.id, a.id, '2026-04-26T21:30:00Z', 'finished', 3, 1, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6501384a-b57a-46b4-8424-aaf0379f6c83', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554864', 'football-data', h.id, a.id, '2026-04-26T21:30:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'cf05af04-f59a-42e5-b4df-ee47798c2c5a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554861', 'football-data', h.id, a.id, '2026-04-26T23:30:00Z', 'finished', 0, 4, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '08b82379-d566-4378-a96c-c4d68f6a4735', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554866', 'football-data', h.id, a.id, '2026-04-26T23:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '13', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ea81be6e-23b4-4978-9f81-4b7decc3ef0a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554871', 'football-data', h.id, a.id, '2026-05-02T19:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f59e7cfc-06f6-4e37-ab6d-1ab0c8db27ee', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554877', 'football-data', h.id, a.id, '2026-05-02T21:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '89d93c30-acd2-4e63-86f0-fe4047afe3a4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554879', 'football-data', h.id, a.id, '2026-05-02T21:30:00Z', 'finished', 4, 1, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0c943446-364d-47c4-8407-cd62e4917343', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554870', 'football-data', h.id, a.id, '2026-05-02T23:30:00Z', 'finished', 0, 0, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '539a7554-21a8-46db-a525-6720a725e124', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554873', 'football-data', h.id, a.id, '2026-05-03T00:00:00Z', 'finished', 1, 3, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'cbdf5806-61cf-41c9-a1a0-3fe5db7aa011', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554874', 'football-data', h.id, a.id, '2026-05-03T19:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e0602a46-d667-4ebc-80ff-79c8d5365515', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554878', 'football-data', h.id, a.id, '2026-05-03T19:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '416ce8a5-eb4f-48a8-8bc7-5fc41094d95b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554872', 'football-data', h.id, a.id, '2026-05-03T21:30:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7f802e49-3ac2-497f-bbc9-acc1a7850930', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554875', 'football-data', h.id, a.id, '2026-05-03T21:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '80c26ce0-3e9f-464f-9050-f2be18f7a997', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554876', 'football-data', h.id, a.id, '2026-05-03T23:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '14', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '90d57ad0-4bbb-41ce-830c-c124b59f71bf', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554883', 'football-data', h.id, a.id, '2026-05-09T19:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b2d79e53-bee9-4841-b166-eb7b3a4de96d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554884', 'football-data', h.id, a.id, '2026-05-09T21:00:00Z', 'finished', 2, 2, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '78dfb62d-8062-4a18-8468-93a6277bb6ad', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554881', 'football-data', h.id, a.id, '2026-05-10T00:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8f57bd85-d5df-4366-98da-04206bc041b9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554880', 'football-data', h.id, a.id, '2026-05-10T19:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '90b6552e-419d-4f0c-9471-ddec871eb534', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554887', 'football-data', h.id, a.id, '2026-05-10T20:40:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '09d8bc58-dc86-4fed-8181-3f2103e059f3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554882', 'football-data', h.id, a.id, '2026-05-10T21:30:00Z', 'finished', 3, 2, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'eced59a7-57d1-48c8-b531-da1f0c60bf16', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554886', 'football-data', h.id, a.id, '2026-05-10T21:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5fceb01c-68b2-45a0-9ea3-c3da38bf40fa', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554888', 'football-data', h.id, a.id, '2026-05-10T21:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '28f14259-dd0f-4c59-a645-b9629e96a879', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554885', 'football-data', h.id, a.id, '2026-05-10T22:30:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '796ad69f-a156-4c70-b696-c2edc7e6c1e5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554889', 'football-data', h.id, a.id, '2026-05-10T23:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '15', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5ce1d5b7-4281-4157-9281-d2d1ea3d7457', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554891', 'football-data', h.id, a.id, '2026-05-16T21:30:00Z', 'finished', 3, 1, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '845107a5-8dd0-4091-94b7-c0289d43dbf8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554897', 'football-data', h.id, a.id, '2026-05-16T21:30:00Z', 'finished', 4, 1, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '54f14bbb-15ff-431b-ae81-46fc3134c0f6', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554896', 'football-data', h.id, a.id, '2026-05-16T22:00:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ffaca8a6-d038-41d1-93b4-39f0d5647920', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554898', 'football-data', h.id, a.id, '2026-05-17T00:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c538da43-6b18-43db-94b8-150ebe58a74a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554899', 'football-data', h.id, a.id, '2026-05-17T14:00:00Z', 'finished', 0, 3, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1470faab-2555-49af-b101-b1e7efba112f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554892', 'football-data', h.id, a.id, '2026-05-17T19:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'fa3fb11d-0542-4906-a868-785776d72ddf', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554893', 'football-data', h.id, a.id, '2026-05-17T19:00:00Z', 'finished', 3, 1, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'afa04157-4954-4d17-a260-fe0826a4c51a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554894', 'football-data', h.id, a.id, '2026-05-17T21:30:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '2d984a58-33bc-44f7-8d51-fec1d80a4f76', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554895', 'football-data', h.id, a.id, '2026-05-17T21:30:00Z', 'finished', 2, 3, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1b01d621-da71-4d6d-af16-196549efeffa', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554890', 'football-data', h.id, a.id, '2026-05-17T22:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '16', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '82f2c187-c030-4564-ae8e-502c06349ef4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554907', 'football-data', h.id, a.id, '2026-05-23T20:00:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'bf27bc5f-18c7-4761-b56b-5dc8cf8f6e15', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554909', 'football-data', h.id, a.id, '2026-05-23T20:00:00Z', 'finished', 2, 0, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '42607f10-9b68-4d8e-ab54-7cfd93dfe65a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554904', 'football-data', h.id, a.id, '2026-05-23T22:00:00Z', 'finished', 3, 2, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '813cfaea-be68-4bf8-a3e2-60bfe9c35e29', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554905', 'football-data', h.id, a.id, '2026-05-23T22:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '147f6fcf-f63e-455c-97a6-95bee7d14c0e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554903', 'football-data', h.id, a.id, '2026-05-24T00:00:00Z', 'finished', 0, 3, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '33e501cb-c92a-4d6f-8299-251aaa93aadb', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554902', 'football-data', h.id, a.id, '2026-05-24T19:00:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '03088835-d298-44a6-9860-04ce1d892069', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554906', 'football-data', h.id, a.id, '2026-05-24T19:00:00Z', 'finished', 1, 2, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '80ca0bc2-bf2a-41a5-b30b-0dca2cb680f0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554900', 'football-data', h.id, a.id, '2026-05-24T21:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5c9ee9a4-8812-40de-973e-ee37ee7286a4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554908', 'football-data', h.id, a.id, '2026-05-24T23:30:00Z', 'finished', 0, 3, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd32b4950-ea3e-4f1e-826d-9b41f31c0184', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554901', 'football-data', h.id, a.id, '2026-05-25T23:00:00Z', 'finished', 3, 2, 'REGULAR_SEASON', '17', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8a541211-826b-46d7-b342-8c7041a8ebd0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554910', 'football-data', h.id, a.id, '2026-05-30T19:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1c0efee8-db9f-49dc-a88e-6e6af1da5922', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554914', 'football-data', h.id, a.id, '2026-05-30T19:00:00Z', 'finished', 3, 0, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e451653a-8bfe-4c8d-99ec-735febf3af82', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554911', 'football-data', h.id, a.id, '2026-05-30T20:30:00Z', 'finished', 2, 1, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd3488403-cc5b-47a8-8025-c1707000a8f5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554915', 'football-data', h.id, a.id, '2026-05-30T20:30:00Z', 'finished', 1, 3, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f45d636f-76d9-486d-89c4-ec08b88b13e7', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554918', 'football-data', h.id, a.id, '2026-05-30T23:00:00Z', 'finished', 3, 1, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '360fd1e7-fca5-4b23-b6d2-3836c6c13584', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554912', 'football-data', h.id, a.id, '2026-05-31T14:00:00Z', 'finished', 3, 1, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6c260201-a28f-4d83-9c05-8008fb5c681b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554916', 'football-data', h.id, a.id, '2026-05-31T19:00:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7344aa8b-8275-4f2d-aafd-98487ed8b43a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554919', 'football-data', h.id, a.id, '2026-05-31T19:00:00Z', 'finished', 0, 1, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '65ac01ee-d596-4b6d-bff8-9856074429a2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554913', 'football-data', h.id, a.id, '2026-05-31T23:30:00Z', 'finished', 1, 1, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7d9955ba-90ab-4f37-ab82-0d75ae75a4fd', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554917', 'football-data', h.id, a.id, '2026-05-31T23:30:00Z', 'finished', 1, 0, 'REGULAR_SEASON', '18', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd88a2eb4-6e09-41cc-8fd1-9651de3bd4c6', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554921', 'football-data', h.id, a.id, '2026-07-16T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b9a1ff2c-956d-4095-8c33-c02dcec3a12b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554929', 'football-data', h.id, a.id, '2026-07-16T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5c086855-986b-46c7-a238-5de0c8bd849b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554770', 'football-data', h.id, a.id, '2026-07-17T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd9adb2cf-cb8d-44f8-9117-d78604e22155', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554925', 'football-data', h.id, a.id, '2026-07-17T23:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '2676a033-d952-442d-8b9a-6659a192974a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554927', 'football-data', h.id, a.id, '2026-07-17T23:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c8af8001-08e7-46a8-8dac-7becaa47bffd', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554920', 'football-data', h.id, a.id, '2026-07-21T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f7f41ac1-9211-4f4e-b30a-aaabb406f475', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554924', 'football-data', h.id, a.id, '2026-07-22T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '86532614-262f-409b-8a59-8b2435bc72f2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554922', 'football-data', h.id, a.id, '2026-07-23T00:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7f56ab5d-2b46-49ad-bc69-4f001a55d22f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554926', 'football-data', h.id, a.id, '2026-07-23T00:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '03b0e2a0-4663-472d-acbc-b85c8901895b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554928', 'football-data', h.id, a.id, '2026-07-23T00:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '52fb4cba-7964-4831-8bc9-5a992ffba117', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554771', 'football-data', h.id, a.id, '2026-07-23T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '4', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '161273b5-ede3-4055-b1fa-4f8e8e6b7dd7', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554923', 'football-data', h.id, a.id, '2026-07-23T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '19', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9028bfeb-a1d0-4484-977a-c9e5c9920208', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554930', 'football-data', h.id, a.id, '2026-07-25T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '90b74e25-6fc5-480b-9dba-6c9eabe3199e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554938', 'football-data', h.id, a.id, '2026-07-25T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3c004abc-afe5-4428-b5cf-76e34b24dd96', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554939', 'football-data', h.id, a.id, '2026-07-25T23:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b84f33c1-5477-4dae-bc7b-856a01a430a1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554931', 'football-data', h.id, a.id, '2026-07-26T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '882a4c76-ff49-426d-bf45-707f74eb60c6', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554933', 'football-data', h.id, a.id, '2026-07-26T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '82d724a0-23e2-4dd6-9815-7141d808d40e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554932', 'football-data', h.id, a.id, '2026-07-26T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '789e5739-5440-410d-af35-13442f3dcba5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554934', 'football-data', h.id, a.id, '2026-07-26T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f25f693c-2181-44cb-abb6-91c01d386313', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554935', 'football-data', h.id, a.id, '2026-07-26T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '39b3997e-a199-4fb6-835b-50c81cd25062', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554936', 'football-data', h.id, a.id, '2026-07-26T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0bf08d5e-8126-4f72-b79a-5d1e619d47b3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554937', 'football-data', h.id, a.id, '2026-07-26T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '20', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e259f363-43a5-4758-aaac-397e8b7e7364', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554940', 'football-data', h.id, a.id, '2026-07-29T20:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1d1eee56-5479-4f15-a022-b7ea984daa52', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554941', 'football-data', h.id, a.id, '2026-07-29T20:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd1db7783-fa9c-45df-8f8a-a449f8982bc4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554942', 'football-data', h.id, a.id, '2026-07-29T20:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'fccd9e00-fd48-4e03-bacd-f64c255b2e75', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554948', 'football-data', h.id, a.id, '2026-07-29T20:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'aa48cb62-f60f-430b-925b-3718b2399ca5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554946', 'football-data', h.id, a.id, '2026-07-29T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '64f4dbea-f56b-4845-b873-94a13e814d07', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554947', 'football-data', h.id, a.id, '2026-07-29T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'efa91ea1-4ff7-494d-a2c4-f8a3daca5385', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554945', 'football-data', h.id, a.id, '2026-07-30T00:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5e79c1b0-a786-42e2-9a9c-2dd61cb092e9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554949', 'football-data', h.id, a.id, '2026-07-30T00:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c0b9a776-78ba-4cff-80be-cf17609bd4c3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554943', 'football-data', h.id, a.id, '2026-07-30T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8d4f5b22-dbd8-4755-a1cc-ef57cd3d929e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554944', 'football-data', h.id, a.id, '2026-07-31T00:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '21', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1113afa0-92cd-477f-8b16-9a04ed1ffd9d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554956', 'football-data', h.id, a.id, '2026-08-08T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '2835e6d4-32b7-45d7-95ef-f5bdee8db3ba', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554958', 'football-data', h.id, a.id, '2026-08-08T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c79acef0-60dc-4215-97d4-4e859c374b15', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554953', 'football-data', h.id, a.id, '2026-08-08T23:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'bc54ea29-0907-43c1-af13-18c7226a77c3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554951', 'football-data', h.id, a.id, '2026-08-09T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '38483619-7297-49f7-aa19-cdf4b9a53d7c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554954', 'football-data', h.id, a.id, '2026-08-09T14:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3014e45b-79fa-4d69-ba0b-8f4ae3a3e417', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554950', 'football-data', h.id, a.id, '2026-08-09T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b3e8d250-dd04-47ad-b0de-5486721bd87c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554957', 'football-data', h.id, a.id, '2026-08-09T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7cb5e5ed-38d4-4460-91ec-70ba03212e13', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554952', 'football-data', h.id, a.id, '2026-08-09T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '61d591a7-5b01-427c-9aff-a2bc45be6c48', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554959', 'football-data', h.id, a.id, '2026-08-09T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1fa96229-388b-4f98-964d-7e7fb6c8ab13', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554955', 'football-data', h.id, a.id, '2026-08-09T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '22', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '55353bfb-942f-4093-b6e3-e86f8767a3ed', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554961', 'football-data', h.id, a.id, '2026-08-15T19:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7390aace-0e30-4e46-a57c-a15a1c1a7ad9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554964', 'football-data', h.id, a.id, '2026-08-15T19:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a2f85ec8-40df-4f80-a4a2-aab169a02655', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554960', 'football-data', h.id, a.id, '2026-08-15T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e9da3468-68d1-4ed2-b7bb-b595ba224b5b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554967', 'football-data', h.id, a.id, '2026-08-16T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5ff355e5-9b8e-4056-b083-852c817f77c2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554962', 'football-data', h.id, a.id, '2026-08-16T14:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f0df09d9-0a87-4368-bf53-1b5af3ae3228', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554968', 'football-data', h.id, a.id, '2026-08-16T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '019cee76-150a-4f82-9295-b752be681d80', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554966', 'football-data', h.id, a.id, '2026-08-16T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd6903b2b-89f1-4a27-a661-c9bfec648379', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554969', 'football-data', h.id, a.id, '2026-08-16T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '174a58e6-6125-4c4a-bc4d-635d6805af7b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554963', 'football-data', h.id, a.id, '2026-08-16T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e37cc3c1-3e55-46f1-80aa-c2e77bb7b534', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554965', 'football-data', h.id, a.id, '2026-08-17T23:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '23', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5db47b5e-f9a3-49f4-b416-39c2096d4d0f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554975', 'football-data', h.id, a.id, '2026-08-22T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e2016dd2-484a-4f9a-bd88-4d8fd23bc864', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554976', 'football-data', h.id, a.id, '2026-08-22T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f11f7a20-eb3e-4158-8085-4dfbe165b3ea', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554974', 'football-data', h.id, a.id, '2026-08-22T23:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '4ff7f36a-e02b-4dec-bdb6-6a954c31e3f9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554971', 'football-data', h.id, a.id, '2026-08-23T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7345ca95-ae00-44b1-888a-72599a9dd244', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554977', 'football-data', h.id, a.id, '2026-08-23T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '792c2ea4-7f24-4dbe-9630-484333d67852', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554979', 'football-data', h.id, a.id, '2026-08-23T19:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '698183e3-d1a2-4c68-b96d-79a6d7856250', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554972', 'football-data', h.id, a.id, '2026-08-23T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b2ba8a6b-fbba-4391-9f82-5f2433cdcdb8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554978', 'football-data', h.id, a.id, '2026-08-23T21:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0b814768-21c6-4d99-8efc-7ec3272dd021', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554973', 'football-data', h.id, a.id, '2026-08-23T22:30:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f5edd7b8-f035-4a1c-8cfb-fd64735349af', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554970', 'football-data', h.id, a.id, '2026-08-24T23:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '24', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7eede5e4-999b-4ade-af0b-36a8c066b50f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554980', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '884a7d2b-4a9f-4a42-a70b-bcd45555a20d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554981', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'd93e95d9-7c9f-4390-8a18-8bc78d51259c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554982', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'bc6a3808-faa1-4043-93e6-d8b1fadb74b8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554983', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6d3257b2-7080-48a6-9b6f-ddb4dc07a83b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554984', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b7c72e34-899f-47c9-886e-e80ff9d3fd05', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554985', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b2c893db-37b8-403a-8351-2dad41baeadc', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554986', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '29c5aeca-48be-427e-a662-f2ee95417eaf', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554987', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f7f9faa5-7bb3-4903-8489-cd53fa64e206', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554988', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '382f72d5-32fb-4b75-89db-f5079e6d7db6', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554989', 'football-data', h.id, a.id, '2026-08-29T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '25', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '4cdc92d8-e3c3-4ab2-9db7-e114f46d21c5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554990', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '339e5731-7505-40f2-a0fd-070477835d23', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554991', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '543aef71-18c0-4320-872d-6680881fefe3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554992', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9d2276e7-6de9-4a47-80fb-3f4b4b916793', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554993', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5066abe0-9416-4577-953b-f8c508145da7', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554994', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3516346a-cef0-4feb-9668-730759720520', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554995', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a63561db-4fff-42f3-9dc4-b8106ddf0525', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554996', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c61ec71c-bb0a-4300-9a55-66df323ebc62', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554997', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b6028543-1421-4e94-844c-f2ee7e717eab', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554998', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '12756969-f1c5-43e5-9148-69903d78aec4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '554999', 'football-data', h.id, a.id, '2026-09-05T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '26', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'af0fb812-8bc1-4339-bedf-5c0e7fb1c49a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555008', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0e2fbaf3-bf61-458d-b233-0fa6ef9de886', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555009', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1bbf2a41-7296-4f5d-8ded-5bf6ef3e21d4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555000', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '512c1ee2-97e2-4c9e-aefe-03a89658de4b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555001', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '4a16d6ac-2cd1-447e-adf4-176b20d532c2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555002', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '89368d90-034b-4a68-9f9f-eb65d227c311', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555003', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '96c4f8e4-827b-43d4-9e81-820f402d46bc', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555004', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8d0ca410-42d3-4c52-9f5c-0ed710813da2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555005', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5a465290-5d95-4a4a-bbf4-d5cc2473949b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555006', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a135d6c5-2641-4441-9242-ed96ade4156e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555007', 'football-data', h.id, a.id, '2026-09-12T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '27', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'cc73b5a1-1fc9-4f58-9693-dfab9420ea6e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555010', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '28dc820a-8e05-4ef9-964e-ffacecce93c4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555011', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '190e26ce-36ce-4950-9c53-f8358abf77ee', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555012', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0e11e30b-8bf7-40c4-81d5-aa249f9ede6c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555013', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '15e2a959-fada-4ad5-a63c-c480871654af', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555014', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ecb7f6f2-3756-4252-88ad-1c857853a1f4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555015', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8644d9b0-a5e1-4728-9154-395dd997eb5e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555016', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '256dda51-5c1d-447d-bd27-890ca37739f4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555017', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '588adc1e-aa31-48db-9193-a3b59bfa6254', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555018', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8d4bc258-5ab5-4622-bfc0-0cd325fa0403', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555019', 'football-data', h.id, a.id, '2026-09-19T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '28', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '31920a20-f752-4038-85d8-707df8a02c3c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555020', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6058c180-c174-4159-b056-4df93842ac3e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555021', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '203c8ac2-485c-4308-b5f7-1655630b9504', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555022', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9eae85e9-e431-4344-9ca1-df5860a1beba', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555023', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5bb782c8-accf-41a9-9b23-e81411f34109', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555024', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c43befa3-cec2-4204-8ea2-42e0562bd5ac', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555025', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '8622d973-0c82-4d36-89c9-f135a3c3659e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555026', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e561970b-ea66-4f19-86cd-7ab10a55b7a0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555027', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '311aa6c8-a732-4565-a45d-b791e3a2cd9a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555028', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '845f33c3-4aa0-4784-b218-212db69d648c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555029', 'football-data', h.id, a.id, '2026-10-07T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '29', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f44f2747-5104-4fa8-9780-f5a0799ac9a2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555030', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7b893836-fd99-4fda-a012-0b92b6e32000', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555031', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e967df86-3ef3-444e-9668-9f8298762549', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555032', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c8cfb7a5-d3d5-4885-bfee-40b8ad203f6c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555033', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e492f41b-c5ec-4680-b3a1-29e3f24be9d0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555034', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1fa1a753-1419-48d4-a8f4-7f19cfb97f3d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555035', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '51aa811d-2ef0-40f6-b07f-edd68e36e5b3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555036', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7d6dc3d9-11e4-4a07-9d9a-891e086ed95c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555037', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9379f02d-7e8a-4086-8ac0-a5ce56709a81', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555038', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7f3dbdf2-0586-49fc-993e-21954b00a9b9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555039', 'football-data', h.id, a.id, '2026-10-10T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '30', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1be0961d-6a4e-497f-8174-aeb3f9bdb0b8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555040', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'aaecb6ab-ed3a-42d8-9d5a-c8d2075eea79', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555041', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a15e99bc-fd20-49fd-ba2f-79cfadee9d48', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555042', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3079ab4f-1cbb-4dae-bdf5-8692590e3711', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555043', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f63be664-aed2-40fb-8983-0774f73b3fe7', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555044', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '85efc819-5bbf-4122-bc4c-207ed7ae040b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555045', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '42e6341f-9723-4209-9c5a-52ed4b485049', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555046', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9a89cc01-7898-4590-a3e0-9ce69d7e2687', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555047', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e9af624f-5d2d-4e99-b6ae-1f1da65f222a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555048', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '72fe3bfc-7c75-48f3-b64b-734c4f4f70e1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555049', 'football-data', h.id, a.id, '2026-10-17T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '31', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a7056c8b-6e7f-4355-b092-cad191d600e1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555050', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a4a78726-b6e6-411a-abf3-54600f835b11', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555051', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'eeac2edd-d249-4983-80fd-189fe8e4304e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555052', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '93f6a209-c2fa-403e-8116-ff8cd03d7d79', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555053', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6a3a0818-d2c8-416f-bd7d-1defaed62b3b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555054', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '801a6c21-08dd-4615-af5d-4e60b77720f6', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555055', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '68c06285-8112-4c65-8ade-9570d5ab6407', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555056', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '49133068-8db3-4a46-bace-dacfd3234f95', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555057', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e0dd16b5-d41a-47af-9846-8fe8462f1ee2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555058', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5c9d4442-96ae-4de0-b657-ce0b2d3a8685', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555059', 'football-data', h.id, a.id, '2026-10-24T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '32', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6b1d342b-de64-4d62-ba69-744672256e53', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555060', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '865a663f-b074-4218-8c7c-070306f1665f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555061', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b4c8cacd-5d8e-4d4e-b65b-6e91269f24d5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555062', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '24419614-2240-49cf-82f4-8dc28290f0b9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555063', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9de506df-f696-4c53-8532-9988ce2bfea0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555064', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '34bb8d37-8b72-495b-9c75-5180ff39de1c', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555065', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5b83d05f-8bf1-4315-a238-c4ea801e3a0b', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555066', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '84c5ddd5-eb5e-47de-8509-effa1d2ae6c6', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555067', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7de4841c-fe0f-4a86-8de6-6b15da95f404', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555068', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c326170d-931f-468d-9096-31f6b2a685bb', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555069', 'football-data', h.id, a.id, '2026-10-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '33', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9d18ab39-8607-411e-818f-ea211f174749', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555070', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'cc49b3d3-c94b-4da8-b25d-6c8973a03a68', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555071', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'fbf1da2d-b77a-4800-9249-661c9c85d387', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555072', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e7448b4a-f956-48fb-8e8f-54eeb8c00519', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555073', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'de53db21-775c-4faa-9a72-5c19d1101ce3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555074', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f91cc9eb-f485-417d-a24d-f9e52ac6b021', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555075', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b0c20ed2-7ca5-4288-bc39-6961f4e9d2f9', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555076', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a089ce90-2877-4a40-8457-0305fc72751f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555077', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'c20134ef-25a6-4327-b8dd-68d30c3ec9cc', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555078', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f36382ac-be91-482c-92bf-c351e7186c3d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555079', 'football-data', h.id, a.id, '2026-11-04T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '34', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '7f19298e-d397-4c84-b45e-7ac37077e42a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555080', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '41a86db2-3cc8-46b1-b804-b08e4678a5c8', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555081', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ab31159f-fa18-4974-a758-836e4983d523', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555082', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6e804ab2-7dc4-4ea8-a301-bdbd5ee4c115', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555083', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '197d6bc9-c903-4e69-b104-31114d33997e', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555084', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1ba9a3ba-df3e-47e6-b1bf-215a90a23f64', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555085', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '90b0d2ef-db2d-4ae4-b88e-56b30f039364', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555086', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'e8c10e4f-c07a-488a-9777-a1e3c99a92fc', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555087', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b3a835f8-c110-4932-9d7a-635882b380c5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555088', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ba091a00-f1c0-40ee-908a-d59a647950c2', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555089', 'football-data', h.id, a.id, '2026-11-18T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '35', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '0584ee2c-49a7-405b-8df4-47ee433da4bd', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555090', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'dc1a5380-5a32-4d66-93f7-6d91dd99d54f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555091', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'a1aa0016-ca95-428e-9c24-3f17ae5f6985', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555092', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9f7e0395-edbb-4e11-a584-0a0cc5136814', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555093', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'df9e04bd-cb1c-473f-9620-70a31f1c07c4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555094', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '692a079f-e459-4062-97b2-a2c9cca3bcbb', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555095', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '59242b78-ef37-4f3b-af0d-6136200d24ea', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555096', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '3202e89d-55d5-4251-9d48-3eb472d9251f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555097', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '9fef8afe-bea6-416b-9f0d-6419b93ca62f', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555098', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '76a70046-01ee-494e-bb08-20aabdd677fb', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555099', 'football-data', h.id, a.id, '2026-11-21T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '36', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '051788df-5413-43a0-9b12-596ff3f956f1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555100', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1766' AND h.provider = 'football-data'
  AND a.external_id = '1780' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '1495c3ac-b477-4ecb-9df3-64fcf886842d', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555101', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1770' AND h.provider = 'football-data'
  AND a.external_id = '1777' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '2e21b1a1-9f7b-4b3b-b67f-a4bddae7c6ad', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555102', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1772' AND h.provider = 'football-data'
  AND a.external_id = '1769' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '89f18078-ad27-40f0-9e73-4cb7e2b45d95', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555103', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1779' AND h.provider = 'football-data'
  AND a.external_id = '1767' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '193774af-7b99-4aa0-8df3-71beb61d09c7', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555104', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4241' AND h.provider = 'football-data'
  AND a.external_id = '1783' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f40fb74d-1d95-49ae-9bef-82b2b25cc855', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555105', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1765' AND h.provider = 'football-data'
  AND a.external_id = '1771' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'f3ba72d0-0f8c-4cef-8980-f9f0655ed7e3', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555106', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6684' AND h.provider = 'football-data'
  AND a.external_id = '4286' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b3560852-0864-43dc-9867-6b6ecc2e8d75', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555107', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4364' AND h.provider = 'football-data'
  AND a.external_id = '1768' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '49794ef3-3523-4207-a6cb-024be1db26a4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555108', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1776' AND h.provider = 'football-data'
  AND a.external_id = '4287' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'b9d31548-9e0a-4054-8249-e0edfc0e5cc4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555109', 'football-data', h.id, a.id, '2026-11-28T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '37', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1782' AND h.provider = 'football-data'
  AND a.external_id = '6685' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '6c5dfb5f-7058-4d28-a4fa-fc3e5028c9e1', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555110', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1768' AND h.provider = 'football-data'
  AND a.external_id = '1776' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '4246f1a1-9ae4-4d97-8ee9-e0735c9ccba0', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555111', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1777' AND h.provider = 'football-data'
  AND a.external_id = '1766' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'ea3ca584-fff8-4e78-9d97-99c363075fb4', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555112', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4286' AND h.provider = 'football-data'
  AND a.external_id = '1765' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '2f7de1f2-d9ef-43f6-9a90-e3e972d98812', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555113', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1771' AND h.provider = 'football-data'
  AND a.external_id = '6684' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '5a84f69c-d4cd-4dd2-96a2-3d4ebd6fa3d5', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555114', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1783' AND h.provider = 'football-data'
  AND a.external_id = '1772' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT 'acda1161-0331-498b-ad8d-52cc4ce4e78a', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555115', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1767' AND h.provider = 'football-data'
  AND a.external_id = '4364' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '642b4d6d-8de9-4a83-be51-79e3dde9d935', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555116', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1769' AND h.provider = 'football-data'
  AND a.external_id = '4241' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '06126722-034f-4ba9-b524-6bd4ed3fb2ca', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555117', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '4287' AND h.provider = 'football-data'
  AND a.external_id = '1779' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '21670c82-5a90-4ae4-a2a7-b15eee1c47fd', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555118', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '6685' AND h.provider = 'football-data'
  AND a.external_id = '1770' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, home_score, away_score, phase, round, group_name, duration)
SELECT '612eab13-df4e-450f-98f5-58bf8d6f6fff', '06baa1de-01c3-4e71-ac6e-a850fa690ec1', '555119', 'football-data', h.id, a.id, '2026-12-02T00:00:00Z', 'scheduled', NULL, NULL, 'REGULAR_SEASON', '38', NULL, 'REGULAR'
FROM teams h, teams a
WHERE h.external_id = '1780' AND h.provider = 'football-data'
  AND a.external_id = '1782' AND a.provider = 'football-data'
ON CONFLICT (external_id, provider) DO NOTHING;
