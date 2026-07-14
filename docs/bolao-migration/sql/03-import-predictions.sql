-- Fase 3 — Import das predictions do bolão (gerado por generate-import.mjs; não editar à mão).
-- Pré-requisitos: Fases 1 e 2 aplicadas E jogos do BSA sincronizados (cron de discovery).
-- Aplicar com:
--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/03-import-predictions.sql

INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '32b8b7bb-b242-40b0-bd8a-26651ebdbe5f', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554769' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b6074efa-e4b7-467c-b60e-e4cb5862e5e1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554762' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '89a95661-41ba-4aa6-bc4d-c9a83e65bd7d', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554766' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5b239aee-cd0b-42ff-abf9-26b8af76fdf7', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 0, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554761' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '31b81ec4-e0f7-4533-8d3c-c40ec3c29015', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554767' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6f9da248-9ecd-497f-b636-c294fc629c66', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554768' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4028c623-ed5e-41d6-9632-1e74d3e7ec59', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554760' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '52eb53d6-97c6-4360-9787-cb7a467c7313', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 1, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554764' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5fdb52eb-d8ca-462c-b5eb-0d6c9f2b1559', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554763' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b7f91ac0-b14a-4d9a-85e8-c35e4105a594', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 4, 1, 0, '2026-02-11T00:00:23.647Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554765' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f51107f1-00f7-4859-90a6-3c0ea4b1ae07', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554769' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '127867d6-f1db-4aef-8a54-732d92261030', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554762' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4e66bb40-a47d-497d-a838-4dc198274068', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554766' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '85537384-fb17-476b-b08a-77e36123735e', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554761' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e6e9c74e-5085-4ae5-ba26-df3e41b22242', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554767' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fa68f423-6318-4208-b304-b8a4bd49fb0a', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554768' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7a6c5936-8c69-45a0-b76f-1c309e24ce16', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554760' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e096c6a1-52e5-4a32-a191-785fc5c9e715', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554764' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2f6ae2a4-b0fa-489d-9c34-141a8558bfdc', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554763' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7197ca45-b3b2-40ec-ac0d-1f5de373f679', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 3, 0, '2026-02-11T00:04:06.522Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554765' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ade76f1c-2b20-483d-be8c-b18a1104bad1', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 3, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554769' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6beeff7f-6057-4d96-97fc-66c865aec57c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554762' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aab09302-9f50-4007-b54e-e7e55dcd6d8a', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554766' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e4c17f9a-5756-4cbe-a345-8f18620c0506', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554761' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3f8050e4-ee7b-44e3-a937-6e3cd24b3aef', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554767' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bd9a81a8-9d75-4b6f-ad07-62065cb4b475', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554768' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f16b62d7-ee0c-4b71-9758-c84ca774e40f', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554760' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fef2724a-e718-4825-88ab-5121d922b4dd', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 1, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554764' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a9487b3e-5e0b-4f6e-bb5c-4af27bcf1bf0', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554763' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2ac27916-1751-4768-ab7a-fb6a7f3af956', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-02-11T21:43:49.326Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554765' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8269a6f1-44cf-4e4c-8b6d-9a39e96d2f43', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554769' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e9db9667-13f5-4ab7-871f-b8456bd49258', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 1, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554766' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '03267e61-2993-46d5-94dc-1e4e789e8d8c', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 0, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554762' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'eb9185e8-d355-46d2-8ffa-28e2799e3495', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554761' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '33792779-cc06-4e70-8290-ff2be0f179d4', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554768' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '25ef921d-c399-49e0-b921-653297b1ee5d', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554767' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'de6353e4-0e48-4207-a910-1525f3ac6714', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554760' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7e5f4f38-cbce-4f42-82a1-89db2929d779', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554764' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '76a12969-8e6e-43d0-aea2-8cc7141a5616', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554763' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aa3616c5-fa47-4790-ab82-899dbc17189c', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-02-12 00:09:37', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554765' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0daa5e5d-db10-475e-bb21-d718d043f2c6', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 3, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554769' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b7c2b59d-d6f0-4f24-a7a4-f8fee16c6c7b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554766' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3adcc7c1-2f79-40cf-99d6-2594b12ed8ce', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554762' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5625111d-2808-48c6-a2ab-e8b005659125', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554761' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7711817d-2e3c-4e85-9371-d78f4e3741e2', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554768' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2bf9d2c0-aa44-413f-bc82-9bc149160452', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554767' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fdea2eec-6716-434b-95a0-c03c04eca803', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554760' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9ef6c2c6-aef3-4807-bb5e-5ec5a61fa5b1', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554764' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '37f5d6d6-b770-4061-abfa-105c785839b9', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554763' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cffa6202-3562-4a95-89ce-46ed56e1a2e1', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-02-12 00:10:42', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554765' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '02d415c5-ff5a-4583-8842-8c442a60b52e', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-02-13T21:34:28.987Z', '2026-02-13T21:34:28.987Z'
FROM matches m WHERE m.external_id = '554770' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7fa71b14-64ff-4036-8c03-885977f9ec5c', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-02-13T21:34:28.987Z', '2026-02-13T21:34:28.987Z'
FROM matches m WHERE m.external_id = '554771' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cd430bf6-f6a0-4578-87dd-098785cdbeae', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-13T21:34:28.987Z', '2026-02-13T21:34:28.987Z'
FROM matches m WHERE m.external_id = '554775' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9234eb26-fd75-411e-b0b9-97ac00f09c3e', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-02-13T21:34:28.987Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554772' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f76e52f7-4dad-413b-85a6-14aac6c6f937', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-02-13T21:34:28.987Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554778' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '32c7dba5-658b-4898-bb52-1d03b4d3b8fe', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 1, 0, '2026-02-13T21:34:28.987Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554774' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '911c47ec-57f4-4682-b0bb-ee09a2109fba', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-13T21:34:28.987Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554776' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '67be996a-bb29-4bf9-adce-f72ec1b83754', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-13T21:34:28.987Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554777' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1803116e-6bcb-4d8f-b26b-9f3488aa88c2', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-02-13T21:34:28.987Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554779' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c92408bb-dae1-44c2-8937-cd9393ff033e', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-02-13T21:34:28.987Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554773' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '903b80a4-0c99-4731-bbb3-de547578b4a4', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-02-14T00:13:47.692Z', '2026-02-14T00:13:47.692Z'
FROM matches m WHERE m.external_id = '554770' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ed0d219d-1a3e-461b-8f09-6b7e8f4a0ea3', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-14T00:13:47.692Z', '2026-02-14T00:13:47.692Z'
FROM matches m WHERE m.external_id = '554771' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8c27c6ee-b6f1-435e-b6aa-08177e9041a6', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-14T00:13:47.692Z', '2026-02-14T00:13:47.692Z'
FROM matches m WHERE m.external_id = '554775' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '472d51df-eb99-4718-8ea1-98144b430721', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-02-14T00:13:47.692Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554772' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4a530478-ca1f-4994-9773-76becd25a882', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-02-14T00:13:47.692Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554778' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '07dbd48c-9995-4dd5-bdc8-d01a69655a8d', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-02-14T00:13:47.692Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554774' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6dc95568-12c3-46cb-9aa7-fe538c8d680f', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 1, 0, '2026-02-14T00:13:47.692Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554776' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '433196e6-0b5b-4752-af37-f24c4cdf1b03', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-02-14T00:13:47.692Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554777' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6e54211f-ec10-4bf4-9584-879bb813b307', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-02-14T00:13:47.692Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554779' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '98164833-b62d-42fe-ae4f-100f55acc785', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 3, 0, '2026-02-14T00:13:47.692Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554773' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f29e4fa0-406e-4280-8649-ca1ef000542f', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-24T18:41:36.433Z', '2026-02-24T18:41:36.433Z'
FROM matches m WHERE m.external_id = '554770' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fec7db48-f92a-4583-852b-fa0c771878cb', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-24T18:41:36.433Z', '2026-02-24T18:41:36.433Z'
FROM matches m WHERE m.external_id = '554771' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3f07f31c-ebeb-46d8-b77c-a87a2f11a4ac', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-02-24T18:41:36.433Z', '2026-02-24T18:41:36.433Z'
FROM matches m WHERE m.external_id = '554775' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c2388024-f14d-4b61-a436-481b69fede9e', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-02-24T18:41:36.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554772' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a9a8b4c6-fed1-42eb-aa87-d5897863c991', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-02-24T18:41:36.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554778' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c1913174-57c3-49c0-a036-fe905687fc93', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-02-24T18:41:36.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554774' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '34d11315-e2fe-43cc-a7a2-352d9537a936', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-02-24T18:41:36.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554776' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '59047ad5-e26d-4f67-a897-9709d21820bb', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-02-24T18:41:36.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554777' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1ffeb8cf-9551-44eb-8d29-2918b369bd2d', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-02-24T18:41:36.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554779' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'af27b829-da97-4caf-9a9f-fe862b7b978f', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 3, 0, '2026-02-24T18:41:36.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554773' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c7dcc3d2-b957-499e-bf33-e9c3260463b3', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-02-24T18:51:17.762Z', '2026-02-24T18:51:17.762Z'
FROM matches m WHERE m.external_id = '554770' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ec85149d-b839-47b0-909f-4bad840501cf', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-02-24T18:51:17.762Z', '2026-02-24T18:51:17.762Z'
FROM matches m WHERE m.external_id = '554771' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4205f4de-c1b6-411f-af5b-fb4a2f4bf133', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-02-24T18:51:17.762Z', '2026-02-24T18:51:17.762Z'
FROM matches m WHERE m.external_id = '554775' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '29b6e860-229e-4689-bc53-03c0da62d8ed', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-02-24T18:51:17.762Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554772' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4143068c-1141-4640-9951-bf6a6a234e67', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-24T18:51:17.762Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554778' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '233a7cf5-9e0a-47ae-9199-a226bc11455c', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 3, 1, 0, '2026-02-24T18:51:17.762Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554774' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '95545726-7329-4140-bad8-5c80a1f01c2a', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-24T18:51:17.762Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554776' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '03fd2d6a-c506-42eb-9b0e-9d4ab4e6c92e', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-02-24T18:51:17.762Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554777' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0e6b102d-2544-41f7-8c75-47bf421150e1', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-02-24T18:51:17.762Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554779' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a90a55d3-e049-4ecf-878e-e30031c29cbd', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-02-24T18:51:17.762Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554773' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '79ec95a3-1519-44c1-83ad-b76334c1ceba', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-24T20:26:16.981Z', '2026-02-24T20:26:16.981Z'
FROM matches m WHERE m.external_id = '554770' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aa85e2d5-6b68-4c31-aae7-7d2d7e858f6e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-24T20:26:16.981Z', '2026-02-24T20:26:16.981Z'
FROM matches m WHERE m.external_id = '554771' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2ad93308-023d-4759-92f5-5beb477ef167', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-02-24T20:26:16.981Z', '2026-02-24T20:26:16.981Z'
FROM matches m WHERE m.external_id = '554775' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '22abeab3-7319-4e26-b152-5faface13169', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-02-24T20:26:16.981Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554772' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a613df7a-a931-46da-ab16-fc7417c8a3c0', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-02-24T20:26:16.981Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554778' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7f4ca3c3-18ca-4ec7-ae7c-e0df0b0a9e9c', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-02-24T20:26:16.981Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554774' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'db891806-4ef6-4b46-8c6b-49527735fb98', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-02-24T20:26:16.981Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554776' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '645d7fc7-c33c-4d60-982f-1959b7adbc50', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-02-24T20:26:16.981Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554777' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0190a064-95d2-4f23-8435-af5ec67dba1f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-02-24T20:26:16.981Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554779' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f07b1c73-a274-4f37-b8f4-c562c11ffa88', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 3, 0, '2026-02-24T20:26:16.981Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554773' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8cd31554-ad36-4234-b766-3c6d6f3376c2', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554786' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fd1cf535-0550-4e0b-bb66-47bee25d83d3', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554781' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e9bca2f5-cca5-4acc-af03-ee0393d5f9d8', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554782' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ca782979-193e-4254-8912-377747c1117e', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554783' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f66b5b35-29ac-4c19-843a-00a985edddaa', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554784' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '96921ae6-1739-4d4f-962a-13a069571f01', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 1, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554787' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '38ad703c-6f46-492e-9746-d04ed82a239f', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 4, 0, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554789' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '29ef202e-0546-418a-bfc5-269541be77ed', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554788' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0faa512b-4dfd-4188-8b94-0d79f373edae', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554785' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6e556d90-1a4c-4137-b0a7-3c153b68ded7', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-10T19:58:25.152Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554780' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b9045a69-a279-4420-9980-95f6bcb03f27', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554786' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'caf6dd01-ebba-4eaa-8997-e6c604eeb81a', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554781' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2bb71cfb-3115-43b1-85fb-d7c880037796', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554782' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '512d2c9c-ae78-479d-b255-a8a71817bb64', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554783' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9d576e18-5fbd-4bf7-bc50-658dab567d3a', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554784' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0770ec82-25fc-4900-bd59-0b5c2e76593f', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 3, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554787' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'dc095be0-e4bf-413d-9168-e0569781590c', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554789' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'dca54442-de87-473e-a5c9-5c654d079bdb', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554788' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f3a4cc15-9e99-49d0-a2b8-1845ac2c64c3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554785' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '51d4caa9-b412-4d00-a41f-0c9333e6df59', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-10T20:00:51.073Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554780' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2c74d388-abce-43e1-93a0-4ceb8648a984', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554786' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3b87e9fb-0ee6-41ab-b61d-02401ccee28e', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554781' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4c08f658-0536-4292-aeac-62c6d3950519', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554782' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '40010af5-f115-4709-a5ac-a3418e5f2a11', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554783' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '95736e62-1f61-4a3d-ae70-c6806ad5ddee', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554784' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '63217ef7-ebea-45c7-a99e-0d42235deca7', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554787' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4f4e758b-fa86-42ab-8090-3b8cd162a12c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554789' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2b6bc2ed-fc82-4745-a642-c71ab6a2034e', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554788' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '512bce8d-90e4-4cec-971c-21002699494c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554785' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8ebbc96a-4ab9-407b-b3d6-1f09e2277fc5', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-10T20:01:11.414Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554780' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4fe0558e-a94f-456d-a863-baf7958ee8a6', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554786' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '36f749e2-3244-430c-944b-ff2eab1a79f4', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 3, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554781' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0cab7096-8b4e-4009-a2f5-030ae96c5127', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554782' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1be84356-4983-4a51-9846-6e6c48641c96', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554783' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a862a007-d7c5-4357-b7fc-f8160c08ba22', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554784' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '20ebc4f2-6a4d-416c-b654-ced77084da34', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554787' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c4f2cbba-7eeb-45a2-ba0e-0424b0b04e75', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554789' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8cdad923-775d-42c7-a8ae-476d15ff007a', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554788' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fcb50c9c-b821-4e85-9ab9-f71c6707b8f2', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554785' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b643c488-02fc-4603-8946-365e30a6d8e3', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-10T22:18:11.727Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554780' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '18d49b95-74c8-4092-aa0b-f6a83efdd786', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554786' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd3bed454-72ef-48b5-85f5-98ac6fc66758', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554781' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f0ab362e-1d84-46f1-b719-016cff60e3c1', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554782' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '991da23d-6537-4bfd-8416-0cc0b3b0d145', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554783' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7546b29a-77da-4eaa-b1ec-cf8cdd468ac3', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554784' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2da522b1-0e3b-4c97-82e6-f85996c6cecf', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554787' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '905573ee-904b-4e95-9b10-22ef566174a6', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554789' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a0993f25-96ac-4501-935f-e3b71301497a', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554788' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9d2455d2-4886-4466-855c-eaec722e1fd6', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554785' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '30385295-6821-4d90-adde-7b6981c1c41a', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-10T22:38:37.385Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554780' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '79e50773-c8b7-4329-af3f-243c77b78840', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554799' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7acfe8e3-4c25-414f-878c-886636ae4b50', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554790' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6353ba49-8c85-4c96-bf2f-dff5ce09f4f0', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554795' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c8ed334d-9749-4dc6-bccd-d6ff0e06cebf', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554796' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2d8978e1-0cc7-47c0-b2ce-7b4a2b6af23a', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554798' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a5daa9a6-c54a-4409-8556-58fd33582dc7', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 1, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554793' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '709c1c87-cad6-4201-b991-685b26b71a68', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554797' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6d5ca5dd-572c-4a1d-b679-36ad95c877c3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554791' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a0114533-74ed-4391-83e7-44e960ef2591', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554794' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '42991bd5-1040-405c-b997-6bb5f39d0d11', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-03-14T15:30:08.236Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554792' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '22028b9e-5ea6-472b-ab00-11187b29f88e', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554799' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '005a8676-4bde-4b6e-8fd7-74b84cdc9056', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554790' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '59e4742b-4af2-4c8f-be7e-31783d0840d0', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554795' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1ed576fa-a36b-41cc-8d15-9c52072b393e', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554796' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '84f51adf-00f2-4c56-8ec3-886992489527', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554798' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '906d41c9-7b23-4128-b765-4b44da7c7d9a', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554793' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '244c5b97-e626-4470-9ddd-5da9a9447195', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554797' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2825389f-df09-4a58-a846-54baa53cdd15', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554791' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '15580abb-9cfa-4cf9-b17e-18a96d979296', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554794' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a24fa017-e4a4-4b59-a4ab-75c893663428', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-14T16:03:19.577Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554792' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8231a02a-1f01-4e21-b67b-d216fc3b7e6e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554799' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e67f6d9e-8260-40af-bd6e-b725cf88c023', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 3, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554790' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0d306d18-81b5-4394-8874-bc5a089b664a', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554795' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '984c5cac-b0d1-43ef-9423-1201ef7a53cc', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 3, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554796' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e205ad07-1d33-4a25-80fa-d6d291b4a8c6', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554798' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0a531936-e982-4462-b578-cd92ae90f27f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 3, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554793' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '61c05620-fb49-4bdc-903f-e2ff57e712d0', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554797' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2e233e7e-ce21-42e7-b6da-8d7979bc3296', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554791' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5c3ac304-8b67-4888-b4d9-d808f65d4438', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554794' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e9bb80aa-b2f3-41ec-b77d-90fc5abd863f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-14T16:13:54.907Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554792' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f94d6c4d-db19-45c7-84fb-d341823a4951', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554799' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2297cda8-1ab2-495f-b7f0-1ea866b6b889', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554790' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '74d0c493-b6e0-443f-a4d5-1ede009a8564', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554795' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8451266c-6034-460c-87fd-fe9e980a5b81', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554796' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '861fc884-a0cc-49f4-bde7-51ebb556ea18', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554798' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8fa46e1b-55f4-498e-8be1-1569d2ac46f2', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554793' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '95500d86-89eb-4e7c-a76a-5b6653b7900c', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554797' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4301a0b4-cd6e-49ad-a8f7-f30eabdf4d77', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554791' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7ee3bcd8-f676-4b38-b7d0-d57e4624ad9a', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 0, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554794' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bc425e9d-60f1-437f-94d4-f5135f6ffc83', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-14T18:51:03.474Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554792' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ded3852e-5396-4951-9bbd-11670422f02f', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554799' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '79002627-f055-4125-8353-f6230861524c', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554790' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e54e5fd2-1721-4b4b-b8d1-3ee98383b297', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554795' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'efc7366d-445f-4b65-9a88-f0cab1d02f76', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554796' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2efa7c14-7431-4d44-81d4-2707c235698d', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 0, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554798' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '03059b03-36e2-4b0a-8a56-9863b0b41266', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554793' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cb0fdf9a-70c6-460e-96d6-14ca904ef736', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554797' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '12202bbd-bc8b-4a75-8808-d41d99e078e9', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554791' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8b158ac5-4d92-4bbc-8e5f-018f1a9dd820', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554794' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6aba2eda-0951-4d01-b85b-7672d0d618dc', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-14T20:43:38.512Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554792' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c03989de-1ea2-4c90-b1e8-750fef0f3b09', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554802' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '232b7bf7-b3a8-40c6-a6c3-2371e3601f1b', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 1, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554807' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8f3d336e-ce36-49c1-8f91-c02fd3f1253b', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554800' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '062f7236-f821-41cd-85e2-ffb52ded4af4', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554801' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f515d274-3a67-426f-b71b-c8f3369c62d3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 5, 1, 0, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554806' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8e1b1391-0a07-4e3b-b5bf-0c33ee03e68b', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554808' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '15b6eaa6-d245-4291-9b5d-4638fa5edad9', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554809' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '88c96309-9d05-4a48-b2ce-2b86e998dacb', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554805' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd9bb0d5f-2926-4590-bcd7-b1f2d6417510', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 5, 0, 1, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554804' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4e715f32-bbef-4c14-9edb-8fa87003bad9', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 3, 0, '2026-03-17T12:22:54.638Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554803' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2b9898df-e6ec-443d-866b-98916e3bb081', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554802' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8b3fdcdc-ec7d-4aac-b305-244b5e71449e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554807' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '884919c1-ffa7-493b-b9fe-5b500c6913a3', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554800' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cc087967-1a37-43ab-8266-734f1365b958', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554801' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4ca73bf9-acc5-4f2d-a719-f0a64b7cd473', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554806' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4cc573a2-9060-4d3c-bd9d-602633687b4f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554808' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e2058b70-aad0-4694-8035-4097eeee31fb', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554809' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f07b2b7a-7d5b-48f0-a645-ba32b1c87135', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554805' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3237a239-3487-4938-a9e3-55f06df04f96', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 1, 1, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554804' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '18f9080f-1dfc-4fd7-a5a7-0eca45d68448', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-17T13:03:36.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554803' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '795663a8-f4f2-4594-b66f-2e9f65b15fc7', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554802' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c23cdc5e-fa64-4fe7-b66b-f66d78ea7ad5', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554807' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '82b9e6eb-8743-43b1-9111-d1ba2353853d', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554800' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd9694894-263c-4426-a5be-7a12790c5d72', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554801' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1c125775-05ba-45b0-9972-bc8953e206a5', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554806' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '40fb2889-b762-4e61-a34e-a28005d34090', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554808' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0aea4617-b0a8-4d66-872e-dce518da109c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554809' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9a2a37a0-9543-40dd-a388-db32e4c289c4', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 1, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554805' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5e09a973-200e-427a-9257-2a08d0013bd1', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 3, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554804' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '818a7c6d-8a63-4856-bfa4-da224c9452d0', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-03-17T15:20:22.455Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554803' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2294d89a-cb91-45fe-9bb3-43fd5d1da33c', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554802' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '85dcd2b2-2763-4f89-b50e-0795792b1315', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554807' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1c088f82-dd27-4042-b4e9-11532999b140', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554800' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6e10122f-120a-4189-b136-213d1320d75c', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554801' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8eaf55e6-d787-4751-80a1-c68d8b220b9c', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554806' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8e2301e2-efdc-449f-a39b-7eed60f90313', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554808' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ce71a1c7-4985-43b3-840a-80ac437ee14b', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554809' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fabe4f1a-7408-4acb-9dd9-4c89523c6e46', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554805' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd48fcda2-4adb-4388-8665-98cc4bcfd503', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 5, 1, 1, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554804' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3754230e-d5f7-4202-8956-89d3d15cb6f6', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-17T15:46:46.921Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554803' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7b5fbab7-0ac4-4d85-9385-86e1f0e44e17', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554802' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '676aec7a-7097-47bb-8a2f-9da45ca38fd5', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554807' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8dcf438a-6874-4cfe-bf57-c9dca28fb977', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554800' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1a24bb28-917e-4e82-a181-5c4a54b9f2e9', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554801' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '66de538a-eb74-4d88-ae0c-87b91aba2dbd', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554806' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c4622dd2-cafa-4e62-921b-8f454c66f42c', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554808' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'eccbc537-b16d-4e12-bf15-ddee902df46b', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 3, 0, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554809' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'add9307b-5daa-4bff-85ed-457d40db9f0f', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 3, 0, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554805' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0987e053-a14d-45e7-9e89-da7b9dcf5a48', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554804' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0f6f298c-61d1-4a89-bd64-d45beb57773d', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-18T17:30:50.954Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554803' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6f42d8fb-52f1-494a-8219-b3ec4edd43de', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-19T12:58:56.679Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554805' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bad699dd-51e3-4d6d-9276-636007aa670d', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-19T12:58:56.679Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554804' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '653ae917-a13b-4662-a00a-673857262aed', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-19T12:58:56.679Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554803' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a4e4cfa7-4395-4062-bb35-53f07695fa6c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554811' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b2111b7b-612b-434f-bcfc-7684740f62b0', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554814' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '746c1581-3dc5-4f37-874c-d73724307b71', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554817' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a83bfc83-c151-4ed5-8603-66fbf35ea47a', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554810' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9bf4cd99-3690-4f6d-8039-329c073c6979', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554813' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'dc0124a0-3661-4097-9179-1c9af05a31db', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554816' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a9698280-02e0-4926-b04e-1ccdf580866c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554818' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '728257be-0e7f-40d3-8212-d5f20fa0a4d9', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554815' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'dd21e9a7-6a65-4093-86cd-976f4a80ef3c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 3, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554819' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '38bc09df-3fec-4b68-8df5-c086645165fb', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-20T15:20:44.995Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554812' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '337c0c2a-1c7b-4dda-8406-7a4700d4b161', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554811' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f599318f-7605-4c49-8718-72cef67edb8b', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554814' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fdc19220-fc6c-482d-a2ec-cfe03a077e36', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554817' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '14be20bb-663c-4557-9c22-8aff39028279', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554810' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a6283dda-e5df-4f4c-82aa-97002d34386e', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554813' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fef34d5b-88eb-4529-953f-fb8f8db8c5cd', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554816' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0a8172a9-e249-4b8e-99e9-e1c217805bd8', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554818' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6b84755f-a0db-4f54-a9e0-4833c4e85319', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554815' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8891d62d-0ca7-4f4a-86bd-922dd81154b9', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554819' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a6162917-7fff-4d9c-9f69-63f74291ff71', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-20T17:00:12.786Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554812' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '475d58b8-f7c6-44af-885c-44133031f8d7', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554811' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f1e2c59f-839c-4dae-a6e8-af80a48d488f', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554814' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '81ea5999-da42-44d4-9be5-5df40ac8c899', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554817' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '04b75d4a-460b-4138-8ddb-e1ec5f143887', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554810' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5063e8bd-b6d7-4f5a-8335-05d684c3bc01', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554813' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd1410551-9d84-487a-a9a8-de49b254c8b3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554816' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '57e41a1e-2b53-4f42-b71c-2a466c662072', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554818' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6c147c5e-1807-47de-9ac2-d9ec6ccf2d56', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554815' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '93a2b93c-7f88-4d50-9128-0e5f2d782c53', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554819' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '45e4178e-7d7a-4546-a795-1d120bb14897', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-21T13:44:20.068Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554812' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '716fdec7-3bb9-402b-873b-3c659f75edd2', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554811' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6385a039-58ad-43a9-b7ae-d01d385e5d08', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554814' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '59782b12-3635-4214-98c2-6b5d6c137a0b', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554817' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ed8e4bea-9c3e-48cb-b105-fd9064153d03', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554810' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '54a5e098-950b-4828-ac7e-dd28a39176d6', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554813' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4e63bd1d-b586-4896-b92e-4ad25382efae', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554816' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3f41af54-0611-4849-8cac-8a75fab29bc1', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 1, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554818' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fceeb95b-fdf9-4a4c-8cce-d65e669b4b85', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554815' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '715fe260-fc08-4c5d-85e8-806bbbeb588b', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554819' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1fe37fcb-5239-4e37-b4b8-6304f8c2f51e', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-21T14:12:35.337Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554812' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ff1e2882-c8f7-459f-87cd-5857595bf97f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554811' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c3f0ef17-4f95-4a86-93a7-bb2d185a895a', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554814' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6664e4e3-6b6a-4eef-bf2e-801ca9a3cb9a', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554817' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e8dc32ba-4552-40c6-ace5-ecec740ee0e3', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554810' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '39a03167-713b-4c6c-adf9-639a8883a663', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554813' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '16db826a-14cd-46b8-b47c-65af721a9164', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554816' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ebee37b7-1672-4610-ad38-06f4d8e57d5b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554818' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '688b3544-4088-4640-ba0f-d48a537ddeeb', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554815' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0c3738e1-a6f2-489e-9970-3c245e131db0', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554819' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b01444fa-862c-4fbb-b500-f355d4ba70b2', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-03-21T14:18:02.536Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554812' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '007d26cb-7ced-42ec-bc91-8b7afccc6306', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554811' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2375cf05-b125-4224-bc38-021631b6012d', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554814' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3453ba83-5f66-4472-ad31-61c07951937a', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554817' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7cd4d753-cc2c-45b5-824c-b55e099214ed', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554810' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8f0f4df0-1bbd-419c-9b4d-139875865741', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554813' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '746392fd-8dd8-403f-aa64-09f95d8d0391', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554816' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2fe3d0f7-1894-426f-8184-52571334b769', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554818' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '504bbab1-b17c-44c0-8f4d-46fe8f852da1', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554815' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fd7796d7-b765-46aa-89bd-c4f77a94d488', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554819' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bd2deddd-cfb5-45c1-ba8d-33c7d0dfbb7f', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-21T14:32:34.616Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554812' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4a83724a-fd8d-4aec-84f3-7f1e031bdc42', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554821' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fc52c129-8911-42df-99b0-b6983783ae52', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554827' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2f3206ed-b12a-4488-899c-b7275d167ef5', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554820' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '29636c45-fbd0-4c69-9987-c646221908ed', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 4, 0, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554825' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f4927f96-dc24-4714-ab91-2c19ce770af1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554824' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9e414c0a-d684-499f-8c66-923ccdc267e9', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 3, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554826' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c0c6e46b-f8bf-418b-bfe9-174d51168028', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554823' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6d6d19be-1a11-4ced-821d-307193d040ad', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554829' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'be67a4dd-0f1f-45c4-bb65-9cfde73563e3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554822' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '735eb9c9-d7f8-4a25-84d4-278b037d399b', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 5, 0, 1, 0, '2026-03-31T23:23:14.043Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554828' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a7de3654-d89e-4816-88ea-a28d4c51ccc8', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554821' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cf763d69-363a-4bfe-865e-26bf02de5be2', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554827' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bda7a1a0-ff63-4306-b7e4-6f3485d3dcfa', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554820' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1223cf01-3737-41b2-803e-0095d9c562a3', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554825' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6d6340fa-7cf0-495b-aa84-49092038a471', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554824' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c00bb82e-55d4-4b97-8a5b-d47b89f68b27', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554826' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '87d7a4be-e188-4bf6-8271-d10a2c8b251e', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554823' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6e0f3b1c-882b-4c16-a343-1b9783ac52cc', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554829' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e9a53022-8013-4a47-bbf8-ebe5b655ae68', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554822' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c7c95706-c805-4412-988c-d346e2aabdf4', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-01T00:59:52.281Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554828' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f8a99571-9cc2-49af-ada7-73f09aced07b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554821' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '544f63d7-6c50-4b5b-b87e-b7c09b719c6d', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554827' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd58f415e-efa2-40b1-a283-c84799c1d6cd', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554820' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6887f411-bc24-4991-add1-714b637f2dfa', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554825' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bf7ad1d4-7e23-4fde-b0ae-2b08b196056a', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554824' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '90e935bf-0a63-41e8-b209-728435830fd3', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554826' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5c8770c6-152f-48c3-8108-1ae6039985d2', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554823' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b07b9ef7-9df7-4e3c-9dd8-87974ed68e0d', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554829' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1e92a9ab-e79a-421a-a19f-336d75df0ce3', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554822' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '41c30239-15b6-46a4-aacf-086838f44919', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-01T02:03:38.952Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554828' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1032673e-5483-4848-bfb1-e3e35f54f999', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554821' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '21939eb0-d786-42e7-8294-9fa4d1a249b0', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554827' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f526c91c-f360-4e95-8c86-c0dd02a94990', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554820' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e4661d72-3c68-48f9-b50f-ed41a471bb8e', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554825' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b96e1368-4a72-4f78-8247-ca7a825dab75', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554824' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ccdab796-52d4-47c6-9ab7-384786ca9e52', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554826' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8d690e72-692d-4c64-b2d6-745a43708539', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554823' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'babce8bd-83fd-4de7-95f2-5528904bb0a9', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 3, 0, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554829' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ca10312a-bd54-4a05-be50-4af640fd543e', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554822' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0bbd58ae-7bca-4e55-b7a7-2d05006ad6f8', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-01T02:04:18.457Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554828' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1c23fe48-73e7-49b8-868f-690c7fe6d466', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554821' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '04acae18-f4cc-4c9f-9d25-20e1808e709d', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554827' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4c9b5823-c945-46be-a71c-8863ffb8c390', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554820' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '221cc030-7448-4c2d-8db3-9c53ab553fa0', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554825' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2d316c49-c71b-4654-9475-be19c8f4d4b3', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 3, 0, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554824' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5e3258c4-90f3-4e70-bc12-488438acf2b2', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554826' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '53d54168-1c2e-41d5-8591-ded6b454b730', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554823' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cecac426-a86e-485c-9d3a-1381870ee8a0', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554829' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a16ff4d1-96ce-4092-b221-18b75866f643', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554822' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0a6e8679-c27b-4bff-9353-e4d12820ab62', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-01T22:08:46.912Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554828' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4551d062-e17e-4592-99aa-70fcf6e49e01', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554821' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a073aa85-d7c0-42e0-8baf-1062baa92f72', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554827' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f8262c17-fa40-41fd-9497-4d3b010c884b', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554820' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cd564a4f-1b6c-45aa-82db-ab3e94bd91d8', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554825' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0d793ec9-1253-4990-aff2-2c749dd6db25', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554824' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'eb907830-cdf7-477e-bd6d-e95df7d86fe0', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554826' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '456fd6b1-550d-4d2a-b7dd-c2706ddf84a7', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554823' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '74e4cbe2-3e54-4f20-bddf-6d4ebe1b455d', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554829' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ead60cd9-5028-4d62-8421-fa9c75eb8967', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554822' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '90f202d0-a978-43f2-80b3-27fe6dd5f5d5', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-04-01T22:11:57.726Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554828' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f99f03b1-b84a-4b4e-9838-22a23851ad8c', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554838' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '19355846-b477-464f-8b4f-63fdfc66fb4e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554834' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '39073897-95aa-45e5-813a-e54115b2935b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554839' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3db1d153-5fd0-4fba-bb90-55eebb055c0a', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554832' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3769655b-5a76-4d6d-8e46-5472c1488496', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554830' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6611cc83-0360-4723-84ac-0b86b7b038c6', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554835' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '17831d99-fea3-4eb8-894a-d3bb0c4625f7', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554831' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6a1178e9-17a3-4dc9-a497-3060a4219b2b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554833' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '830562ea-59e2-4dff-8dc0-d60eacd6a1b4', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 3, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554837' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b505455f-41d7-41f3-a4ad-5b4c675171d8', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-04-03T11:24:02.022Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554836' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b749ceb6-9a1a-4407-bf8d-1b8fa96270f1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554838' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '15964217-6a1d-4760-88d1-9662a6367949', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554834' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1bffcf76-0937-4d62-aff6-17dde8569bb1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554839' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ba2d9ba7-18c8-4b34-a387-eb5ee60b732b', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554832' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3c6b4b70-d24d-4157-8e93-79cdb8e55e40', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554830' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5de8341c-6e4f-4dc7-8358-cbaaed3e6f63', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554835' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9d13a0a5-1d4c-4125-9a82-e225747d9e49', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 1, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554831' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '33e573ea-7923-46e0-935b-219c507715fe', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554833' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e5bf635a-9be5-4d18-b0e7-eb92b435b3e3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554837' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5fd208d0-901e-4b02-8a26-d87a441349e5', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 0, 0, '2026-04-03T11:26:58.717Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554836' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '33f9f7ea-053e-4a55-89b1-cb34e3a03279', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554838' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6113299a-f72a-4278-8b0e-203c227b70b7', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554834' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f4228dbd-3dab-4d36-9950-c844c7e4099a', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554839' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0bc2983d-7336-4508-84f2-3703ad70cc75', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554832' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '99b12bfe-1097-4662-983e-f1f1f719be2d', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554830' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '244df388-a411-4a46-8edd-14220cfe919c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554835' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '31cb0f6e-3b32-4413-93a1-cdf0d1b3b0d6', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554831' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0403863c-784e-48b3-b3ef-aa366d7fc860', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554833' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '211df5c0-4a90-4509-a91a-e7e35ba7c8b7', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554837' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8020d21d-8397-47e7-8686-f768bd9da934', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 0, 0, '2026-04-03T12:19:39.988Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554836' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c3bdf949-a23b-4817-9a46-b9e5bdea44f1', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554838' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '31e8f1c9-d70b-4947-857f-bc89d8ef6fd0', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554834' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '14287e65-5809-4ccd-a371-9f732451df69', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554839' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e17dac19-29fc-43cc-b600-06a5fafaa9f7', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554832' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9f3fe231-0751-40f5-aa52-09f864c9ef6c', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554830' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1bce3512-a594-4018-8a0f-41d86e0fc02f', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554835' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5bd093f9-d78a-4f4d-b9c6-0b157a714042', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554831' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '582ed4eb-0170-49b6-a31b-950fde35efed', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 3, 1, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554833' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3a58a44a-7312-4294-ad63-2c7db0745ba0', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554837' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '57437b33-4b2d-4969-bf9e-6048173badf9', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-04-04T20:30:41.977Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554836' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aadc2b40-f629-4b82-98f8-809e74201f40', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554838' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'da57df47-3d84-4679-8606-80d2e3e64a20', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554834' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '05077b3e-ccb1-45e6-a61a-12ab6fa2df35', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554839' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c87ef5a4-e478-491e-afe4-883049ef6e56', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554832' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd3e44c53-c9f5-4109-869e-d131a669016c', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554830' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ce0ccb5c-9f76-4299-884c-2e9bd48b757a', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554835' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'daccfa77-5c0f-4826-aa59-4b1942d1f23f', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554831' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'dfdc004d-3698-4fee-a782-39cde4d2bbeb', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554833' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5dc1cf06-99e2-4438-9408-26d2d3ce68ff', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554837' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e70d9892-2d5c-4565-9575-021254ef9339', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-04T21:11:48.302Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554836' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9809103d-fde2-4526-b797-a084c5eab732', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554834' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '648028b9-b6c9-414a-9abb-a0938aa1d748', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554839' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '282069ab-f856-4fa0-9342-d65fc232fdf9', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554832' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '04266d94-fd4a-489e-92eb-97182ac84a37', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554830' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8f869f78-40ce-40fc-a39a-09279e1bc5c7', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554835' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '045a02e6-d213-496d-9490-2426669af207', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554831' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8e49251e-8bf4-4bd0-b36f-89437ede67da', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554833' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '347a823b-0d52-4052-9201-34edc2967f58', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554837' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '238ded87-2f3c-4ef9-b89d-c7f7f41f618b', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 3, 0, '2026-04-04T22:44:33.086Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554836' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2100c8ce-911f-4070-9ad6-ae4fd858815b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554847' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7ac626ac-224e-451c-981b-fe9e90ef7294', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554849' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c0f8d642-25be-42b1-af0f-8492071d5408', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554844' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0c699632-ba63-4268-9895-835b7e170a0c', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554846' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e6c17cc3-ad20-46f7-a1d4-069d3eff3895', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554848' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f7cb80a0-4a41-4198-838f-b8c639520ae5', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554845' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ddfecb8d-262f-4929-bf1b-7c140daee9b1', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554840' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1d866fed-fdfc-4e6b-ae67-4342bd4c1e22', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554841' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7f212a1f-0b89-40fe-a037-c49934c566a8', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554842' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '812ffea3-9451-4a4e-b04d-6c6174ade9d9', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-04-11T04:14:06.100Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554843' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3c7888c8-d652-4883-805f-17a3d42b54c4', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554847' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0366e821-598e-4693-b958-1a5fcd3c4a17', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554849' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4b3c6272-38d3-4323-89ce-d55597da7f4f', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 3, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554844' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '57c18725-7df0-4eb3-b9bc-c89a6cc63117', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554846' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '07b79574-4739-4e60-a0b6-609a7fbf1969', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554848' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3a2b9b35-2dc4-4859-99a3-945db1fa2882', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554845' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '546650c7-0512-4baf-be55-24c40c0c7097', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554840' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2acc89d8-fa16-4efa-baad-c5a73ccce864', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554841' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'db3365ef-ff4d-4338-9368-a03db8fcf7e8', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554842' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9e915024-991d-4378-ae82-e38cfd6918e4', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-11T16:13:33.990Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554843' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f0114a27-0386-4689-b942-e55224c7673c', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554847' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cc8da4bf-0c62-4f73-9d41-7efbeef39209', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554849' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '57210597-8a7e-4b40-bcb8-bcb773c6b3ae', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554844' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3ae97d1c-6cdd-44d5-840a-54cc11c538a2', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 3, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554846' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4ca219f0-7aa6-4091-b1ea-5bd3f2a4d532', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554848' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '320848d4-f63f-4462-8621-1103fe3da8a3', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554845' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c96a959d-6abb-4c50-a3bc-654881fb1543', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554840' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '320e625a-d2eb-4559-9d71-58e90f1d05b7', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554841' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f8ccb7a0-990c-481b-8ed4-5899587b505d', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554842' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '303aba7f-e216-4c8e-9425-c9dc142566f8', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-11T18:48:20.589Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554843' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '34730e75-8d80-4bb0-9ddd-c4678d47d066', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554844' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '99cd4f0c-3a0f-4978-a6e8-266b9e7ff79f', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554846' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9fd6acfd-6988-4eb7-b129-dd89515253c4', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554848' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8c2afb33-b9ce-4857-99a9-41ea38bd7f0d', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554845' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6af9cdc6-1288-498d-adf7-f65a44594803', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554840' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '81ea29c6-0a96-41da-9f1c-4da73796c3dc', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 1, 0, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554841' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7d57f168-e076-47e5-948f-3a95d322e54b', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554842' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '65088151-a20f-48d9-919a-5654fdbc592f', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554843' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '121810db-cafc-487c-9147-b962b5798830', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 3, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554844' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4f07abd1-9316-49ee-9409-6d0692b2c9e7', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554846' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bcad214c-112e-4f17-bcf7-81185adc0905', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554848' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '526c8dd5-02ce-4b48-ae86-4c04c1e0d38c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554845' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5067e104-b098-4553-87d9-ad6c643588ae', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554840' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '785b6026-94ff-4fd7-b911-15e6e4b050ad', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554841' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '343e8c61-c151-4736-9738-c472d37b1c98', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554842' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '40cc708a-d882-4514-8921-e16f6cac68a9', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554843' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '74f8bca5-d487-4be3-a826-0d4a43def827', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554847' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1a014f3f-1820-43ac-88d1-70f46c833516', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-11T20:07:03.612Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554849' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '97b3fab9-698c-4317-a2fb-834cf450f964', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554849' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '290088a5-037d-4459-b8e1-740076f9bb1f', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-04-11T20:19:50.298Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554847' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9e61a107-32c9-46db-bdb9-d7703b3ecab6', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554851' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b6bd8dc0-9de2-40e4-a269-6f6cdcd205de', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554858' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '649ea34e-f797-4bd0-ad2e-7714775ae012', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554859' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5caaee03-5ba4-4bec-ab21-430a77f59cf6', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554853' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cc545cf8-00a8-4d23-9554-71048793ac29', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554855' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bf5dea5d-f5f5-46b1-a964-97bc584901ae', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554852' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7994f8f7-b8bf-4109-9443-bda06ea6ee56', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554857' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a56275ed-e2ee-4905-a542-2c31d91f2cab', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-18T20:41:46.066Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554850' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a283dcc5-7812-4015-b886-ec978dd850a3', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 1, 0, '2026-04-18T20:41:46.066Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554856' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6b09c2c8-ee60-457d-931a-ff2f759ee084', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-18T20:41:46.066Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554854' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '05c67c93-9c63-4b52-9120-bbae8c522609', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554851' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ba999a66-ae52-4599-9b9d-67796e5538a7', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554858' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8ef450b6-1048-4f02-be43-463b83871deb', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554859' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '74b9bb0c-00d1-4e94-bb1a-1ad4d748eeac', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554853' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '19ce5d07-92a0-4829-ad3f-acb14261113c', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554855' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8b7aa54b-b8bc-4d0a-a897-dd13d3b45e89', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554852' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'eec78082-95cb-4cdc-afda-0914d1dbb869', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554857' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '91d10e09-06f7-44ce-a7d5-bd9f49d98e81', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-18T20:42:34.433Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554850' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'feb0f3e1-17ab-48aa-b46c-ff5ac28f600c', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-18T20:42:34.433Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554856' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2be10f56-c113-44e5-a47e-2a43fc08e940', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-18T20:42:34.433Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554854' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8b8ad3cd-bf94-4712-84f3-12a321e67a5d', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554851' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '840a330c-d954-4e12-97a0-c8b9cd9c26e2', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554858' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '167d5107-4b90-4a7a-b1fe-a41d2747fb85', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554859' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e28fb162-b2bc-48c6-b68e-ab567dd95ff6', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554853' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd9f73617-302d-43ce-9c07-324fe822cb48', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554855' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '18542b0c-6e1f-4972-aac3-c631bea559f7', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554852' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bb5cc728-7842-42a7-840a-6e894407c39f', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554857' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd1e204d8-dcf8-4c5e-a7fa-eb6dcacd15ae', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-18T20:46:49.229Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554850' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9f853b01-e645-4887-be8e-a7c73b034a76', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-18T20:46:49.229Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554856' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'efba8f3c-a8c5-492b-8687-9ba62c9a925c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-04-18T20:46:49.229Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554854' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2c3ca466-9411-4216-ad4f-ed5116960de0', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554851' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '701657b2-44bc-485e-a51a-5a477e6f3c4e', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554858' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e5f1074f-36ac-4ec6-87ad-8efbec56bed1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554859' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '21b63b73-958c-4514-8646-ab8e501964aa', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554853' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f2d7ff1f-7968-4ac8-b2fa-2a471ff6080d', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554855' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f57d7d5a-e2ae-4db8-8fe9-078e175187f2', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554852' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4ad4c327-d754-4ff7-8ca8-277083cdf847', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554857' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '26203d78-68c8-48c5-9621-0cd7a18556c4', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-18T20:48:19.598Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554850' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cc682913-0169-4cf3-b407-4408e9671f96', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-04-18T20:48:19.598Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554856' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3b0b08de-e658-4d91-9154-85d41bfbc3f4', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-04-18T20:48:19.598Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554854' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8b33549c-1911-41c0-abf5-816a5ebc5ce6', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-18T21:51:36.363Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554859' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c4417f47-d55e-4002-a037-c74a3c5677bb', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-18T21:51:36.363Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554853' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c2eb5a9d-a668-4ce3-83c8-355c749bc886', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 3, 0, '2026-04-18T21:51:36.363Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554855' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b587e2bf-94fe-42d6-a4d2-e7bf5a0eac62', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-18T21:51:36.363Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554852' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2b791852-c61d-4f74-b2a0-8e24df1f5479', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-18T21:51:36.363Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554857' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7cb0c9dd-829f-4720-8154-bf5b35dc7488', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-18T21:51:36.363Z', '2026-05-31T11:51:02.281Z'
FROM matches m WHERE m.external_id = '554850' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '804aa33f-3cea-491e-800c-a91ca7e05b36', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-18T21:51:36.363Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554856' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '830bbefc-c4de-4ffd-8c2c-3d97bf1468ec', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-04-18T21:51:36.363Z', '2026-04-20T01:47:58.539Z'
FROM matches m WHERE m.external_id = '554854' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1f3904f4-50cd-4685-916f-6a99a6a64810', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554862' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '061bd49b-ee4a-4d07-b694-cd15009e988e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554863' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'afcff6f8-d814-4a90-8e90-fd8d5f72e63f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554868' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '64eec55f-8e1b-460e-9733-cc545149ce92', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554869' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e2f494b1-0087-4293-973e-8ce1510f1615', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 3, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554865' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1b3b68a5-f174-4d79-aa02-cdaf42d351ab', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554867' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1663b24f-885f-4576-a9ae-836b67f47ca4', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554860' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e655a90d-f3fe-4b3f-8d77-3aea455b1c1f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554864' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5cc66344-3c1c-4386-8956-ca874f196f72', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554861' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7553f5c2-bee7-4c26-8994-788a3d4c4604', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-23T00:23:21.432Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554866' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0ef90af0-d97f-40cf-bf8f-e9edf3748f65', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554862' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6188c926-3456-4acc-a92e-45b958bde330', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554863' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b99459e7-98c4-4256-95da-a032e80b41b6', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 1, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554868' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c00d4f64-a54e-4aa2-b1e3-6ad125a9a924', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554869' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b81fe773-75ff-4e65-80b7-9241103189b3', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554865' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '54301737-120d-48ef-bebb-34354c45a9ae', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554867' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '75604385-ae3d-4aad-9a41-1e07c3c0334c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554860' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3a0c1184-9c5a-4f05-8771-a7fea22d1fc9', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 1, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554864' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '95f389fe-e0aa-4a94-b1bd-fafc1ab2d433', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554861' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c5c970b1-c8ed-4677-a96c-29565c6f8742', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-04-23T00:32:29.819Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554866' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1f75e6ec-7406-41cb-80c0-fde22ff9ba04', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554862' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '76b5adcf-fa83-46db-9d72-a1679773edf1', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554863' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '67146bf2-3854-4ead-b6b2-4a88a8ac1d5b', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554868' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4d30df7b-f997-4c4a-b6b1-067fbe5785d9', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554869' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e91eaca2-07ad-4809-83fc-e65ceba865a7', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554865' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7e693a9a-b9ed-4fc8-84fc-72282cd7f86b', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554867' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f891c795-c1ec-40e9-9c52-a7fedfd9151a', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554860' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1f94f2f8-409f-4da1-8107-046729a2328b', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554864' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '87013fc6-c646-48ca-85ed-b684cdfc5f10', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554861' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'abbc0fe8-0c89-443f-9572-eb2de3d44311', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554866' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3c56ac00-45fe-4c49-94cf-a68856aec92c', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554866' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bc4834b6-0db7-45af-80ee-ced92e6be9f6', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554861' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd21f5552-e9b9-4521-a4df-b5406e517738', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554864' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '50635803-3cb6-45ed-a2ed-a85b437f3887', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554860' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b829f3a3-2acf-4878-ab3d-142bfc5fb0fd', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554867' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5b405558-e269-4cbb-9a95-90a6e49badb2', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554865' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a708e44b-d256-4656-b16a-96d8c89a77ed', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554869' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6796da26-1b40-4725-93d4-5365fce4feb1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 4, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554868' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '011a2183-b6ee-4acf-8548-19a0174ccdde', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554863' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1640329b-24b3-4c6a-a9a7-fc3119f63fc4', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-04-25T15:25:51.558Z', '2026-04-27T10:16:30.450Z'
FROM matches m WHERE m.external_id = '554862' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '40d6bf47-c366-4349-8ee9-39269064a097', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554871' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '04795e6b-ebf0-4077-971b-cd86dad70093', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 1, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554877' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '47717e62-bc7c-4687-90ac-a56298e39ef0', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554879' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3cb98d66-b0ca-471a-a2ce-47d9bfaf70fb', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554870' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f3e7d2c3-6950-40e4-ab74-051c2d5e2292', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554873' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '815ae096-ed7a-4729-95da-5df77f37e2c4', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554874' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f3ea87c6-3af5-46b6-872f-ac92312c9677', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554878' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '49e485be-7f21-4f3b-a2de-f957b210b7b1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 1, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554872' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4150b844-8a27-449b-a1d9-46cb2b00b847', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554875' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'da248890-8473-403e-8ab4-65c7bcf51861', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 0, 0, '2026-05-02T15:52:31.379Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554876' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd54ce5ec-b130-42d8-b8fa-ca985f528769', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554871' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '229c2d2c-d6b5-47db-9039-c860d0964ca8', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554877' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '307e89c7-abd7-4c04-b047-560ee3e2cc0a', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554879' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5c6b2434-afcc-405f-b8fd-f58f99f234be', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554870' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '72a829ff-d0f1-4a50-8d6c-54d46cbbc584', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554873' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'eb4f743f-fa4f-43b1-9e9a-8a4a142aeb2c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554874' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '09bba670-c072-4bba-bf1b-c0725bac70aa', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554878' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f62fab9a-737f-45b2-b504-d8606e3cda2a', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554872' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7b112ae9-621e-4ae7-980d-1bb46bb97b6c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554875' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f7ca3653-3877-4335-a000-0d98cf40e712', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-05-02T16:11:35.199Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554876' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '47a4e245-e919-4bca-8d4c-6cd51adb9550', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554871' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ebdf4326-f1a8-4e8d-ad1d-7d8f7579b44f', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554877' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5edb9c0f-d85e-481e-8af7-74bdbd1799a5', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554879' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4951a1c8-5fd0-4bc0-b0d0-ac9504e6a96f', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554870' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '703dd716-070b-42bc-ad38-a8cc8da61a50', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554873' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '91735383-4c3a-4283-adca-0eedc9d6caaf', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554874' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7fcee716-ce87-4fff-9a2e-c4809acbe590', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554878' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3c04171f-c3fc-401f-8f50-a91029661a35', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554872' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2cd45e18-2f1a-476f-a678-c7ce30d3c131', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554875' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2e01950b-b22f-4d27-ba3f-ec1f1ffbf2b5', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-02T17:25:58.096Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554876' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '85592bdc-f2de-495c-a9a5-30208c795cb3', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 21, 0, 0, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554871' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '550b558e-900e-4ec5-8f44-946221798a84', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554877' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a06e311e-8585-4f3b-b43a-dc257ecea31b', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554879' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5d6fbb84-f11b-4e8c-9202-46c0cdc3dff1', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554870' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'adf838e6-2c68-400c-b116-04bfa4e68552', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554873' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bd34a624-9de4-47a4-9550-04d89570c753', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554874' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8582a196-d9fd-44c3-bc5a-9ef5037ac1b2', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554878' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6d07c7ea-7329-4438-bc43-f852b0bd4c4d', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554872' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '65227121-2507-4273-9bbc-da0176c028f0', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554875' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3985384d-d78c-4149-89ec-941dd7515193', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-02T18:07:48.088Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554876' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c5f307b5-b23a-4e03-a1ee-4c748332c1fa', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554877' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '98bdd555-3179-4974-914f-667fed3089c8', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554879' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'abb9d341-9c76-46b6-a442-fdee1c4e37bb', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554870' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3a390200-bc94-4b11-b0ae-e23085572a0e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554873' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '72540e70-5840-40e5-9ece-fc26243aeb7b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554874' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd0b82030-2c1a-4113-b258-79177807d254', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 1, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554878' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd5c8afcf-b4ca-4de5-85b0-3343218db841', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554872' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9392aee4-8da6-4a1a-8d76-3c409c0b919f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554875' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd89d14e1-e2fd-43fd-ae4b-bf9711304f8f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-02T19:50:10.171Z', '2026-05-04T01:56:45.472Z'
FROM matches m WHERE m.external_id = '554876' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e7ccbf7f-cb4f-41fc-be4b-e9eb60f7cb30', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554883' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ab0a6255-1547-41d4-ad6e-02a544062b4a', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554884' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd534a5d6-f994-4c75-a5b3-7309a58185a6', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554881' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2665b3b2-5f49-4574-b986-13035c48ec98', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 3, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554880' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0d41c477-2655-4a67-9967-2ea69c309132', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554887' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd8cd6331-4b55-4321-bb2b-80e1fcf63395', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554882' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0f5c632c-5ec4-42bd-ae88-02ce4c87d5ec', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554886' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '853950b4-adcf-41b4-a6e7-434bb2ecf5ff', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554888' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '85d93f33-77a7-4c0e-a82a-10d4dc6b502d', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554885' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2af1c381-c1c1-46a4-9131-aeb8985056c3', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-08T23:52:32.848Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554889' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e887d22a-b496-44c6-b47f-35a921c49928', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554883' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3388fa85-32c6-4d73-ad26-d320c2b154ec', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554884' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '61650b5c-f50c-41a6-8772-dc92f6e6992b', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554881' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '49d795bb-ffbe-48d0-8816-2d9cb566b176', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554880' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '755e657d-0357-4580-b7ce-1ffaf27a144c', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554887' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'cfcd6fd1-c36f-4251-b801-786e6dbb3eb3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554882' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aa34f793-7dc8-4eeb-a08f-9a0abee73241', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554886' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2cf88b72-6cce-46f8-a7ba-52fb74e5c0dc', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554888' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '27ef772e-1999-4360-805e-fc2b5a987deb', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 1, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554885' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '72f3110e-1493-43d4-97bf-03a952644885', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-09T15:35:11.020Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554889' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ebf58e6e-2925-4f8b-8675-77a4958fdf51', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554883' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd9534b6a-4030-4b6a-b61d-63fab4ee4a10', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 0, 1, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554884' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2df34e6d-015f-470c-88bf-933436d2936c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554881' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6f0fbd49-65ed-47d3-9111-d51d471aa0fc', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554880' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bab0a2b8-24d3-4542-bfc5-ff62f1fc590d', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 3, 0, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554887' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '03ebef96-5007-47a7-8fd9-d6dc196bba26', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554882' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2cdb2523-62ca-4c57-a819-e8e900032f75', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 1, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554886' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '761080e7-3d71-45b3-87a0-97878eb4b891', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554888' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ca6cee4e-b205-45b4-851d-0ad8f8d0a1e4', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554885' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6fc93d89-05b5-4ac9-8e61-750b24aba57d', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-09T15:44:17.503Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554889' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6cbd847b-0d87-4d9a-8558-1643d6dc7f49', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 3, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554883' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '07d94420-0fd5-4538-92bc-087c700eddd0', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554884' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0afea549-7b46-43b3-8d8b-532fc223adc6', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554881' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '866ce609-57b5-4736-96fe-0032531607aa', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554880' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b68430e8-1a85-4ce2-a19d-1de09a53e962', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554887' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a4c6712b-17c9-46c8-827a-40c1051c18a4', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 3, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554882' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4d2f4427-1511-4f4c-9665-23d773fd98ba', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554886' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9c044176-fd8d-4dbb-9268-97d3416a74e5', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554888' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '26ed21bd-0095-499d-ad3e-3bb36bc915ab', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554885' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6794b299-0135-4685-886d-8f0c052b1652', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-09T18:23:59.400Z', '2026-05-11T11:43:12.580Z'
FROM matches m WHERE m.external_id = '554889' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ae74fc9c-9f5f-48b0-ad49-58117a51621f', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554891' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b7d73141-e283-4e69-aef9-e686610cf06e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554897' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '43cbbc41-3c8f-44c2-a91d-2dc5ee8bfeff', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554896' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8ce75dab-b98f-42e8-842f-223d8b86d1e0', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554898' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '42d20e1b-d0a3-4818-a93f-9b6d3222236d', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554899' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1251cc8e-ad3c-444d-a815-732918fa5169', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554892' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '443e22ac-6666-499d-90b6-1a421614bd52', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554893' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e5d0dc9b-758b-4033-bb7e-e22131ebcb33', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554894' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7d21de30-d469-43ee-ada9-1461a82244da', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554895' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b46d89de-8f51-45cb-96b6-3444c3511e65', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-16T13:20:20.171Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554890' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'addf1556-6619-4252-b910-a49af8a59765', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554891' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8d9b7d50-adcc-44b2-8597-89bd1b90a625', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554897' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '80d112df-6d20-4e3b-be9f-ca65324b6735', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554896' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1bf837ea-9807-4e50-8cdd-855d8d27f84e', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554898' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1b026998-af78-4e08-9066-68f7e3d41d87', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554899' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0f90c214-304e-4eb6-8056-91226ce90b04', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 1, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554892' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c709b3aa-34cf-4a5b-93d9-054f52dab5a2', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554893' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0f62204a-ee8d-4d4f-8336-baff8d61f218', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554894' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '237ac706-9559-46c7-bc3a-731f6a404204', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554895' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '99b82d99-3cc5-4dc6-9e80-cc968b14564e', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-16T17:51:32.923Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554890' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4de35c81-0735-4247-a179-080cebe6b57f', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554891' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'd16a566d-7a03-4368-b19d-32b1a88f7788', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554897' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ca2e6e34-ae51-4bc1-a301-d698c062e375', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554896' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '09cc6ba6-5279-44ff-b4e5-c178885ac059', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554898' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '71614ec8-c9bc-4f8f-bd34-ebd2a703278f', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554899' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9ff3f777-386d-4f3b-b5c0-094394ee2b1b', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554892' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'be973ee6-b1ae-41b6-b124-6785ea1172d4', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554893' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3c3e9ef8-5d77-49d8-a93a-4efedb90bb92', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554894' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ddc6db1f-436f-434a-9500-5177ad6095d0', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554895' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ca5af422-dcd3-4927-81de-a2987aefc15e', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-16T17:54:03.811Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554890' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ba1718b9-083c-47f7-825b-afb2c695f4f8', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554891' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ad6456b8-958e-4f35-981b-9df7d94bda64', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554897' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3403d488-125a-4f17-954e-e655f69b8986', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554896' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7d17ad12-2942-43ef-bb84-49c41bb7deab', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554898' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'de05eced-6035-4231-8950-ee37772b8362', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554899' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e18c4f48-9dce-42e6-b871-50ef0586220b', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554892' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '396f5189-e5a1-49e8-99e6-40f181a62864', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554893' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a48d2ccd-f5fc-4623-abde-75d0c27326eb', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554894' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '34e1af71-8d6d-4aab-8e01-01a0be8c91b7', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554895' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9f0c53b0-4cc6-40aa-a853-94effd4a2ba2', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 35, 0, 0, '2026-05-16T18:44:19.398Z', '2026-05-18T00:38:48.459Z'
FROM matches m WHERE m.external_id = '554890' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3d64fbae-234c-4054-9222-ca94c0491f79', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554907' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8675c233-74c4-429a-a026-04629a9905f8', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554909' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bcdf5518-acc9-4f49-898a-e1714a71f2e3', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554904' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5b27817f-2694-4f9f-87fe-f99461f01308', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554905' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '84d4cf49-5483-47e2-a46e-c51f395cd4b1', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554903' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0870b399-9d49-45db-8165-c7b76119f9ed', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554902' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '980df1e2-31f5-4585-8e18-3298b4103147', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 1, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554906' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '45898b43-6a80-4bcf-b231-fcfa084bba01', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554900' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '42f6cdc3-740f-48c6-8e94-34fbb1969bda', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554908' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '491c6249-9610-4ee4-b658-8edd262cf453', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-23T18:54:59.608Z', '2026-05-23T18:54:59.608Z'
FROM matches m WHERE m.external_id = '554901' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bb3fe682-f96f-45d8-a0f2-b6b1e2206366', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554907' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4b255cb2-ce5b-4453-abbd-b8ba8d537560', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554909' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '139d5469-cb15-4cdf-8151-579ac67b8db4', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554904' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4982e3dd-ffad-4207-a198-2c9c3a7b61e6', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554905' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '53f152ec-1235-49e0-a199-6677576a8c71', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554903' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b9d08a7d-b830-43b9-a5c5-b30c42acc2d0', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554902' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fd0cf06f-72d6-45d6-af5f-47fa4839b9e1', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 3, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554906' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'dd301975-0dfd-42f7-8e24-178985e97c8d', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554900' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '005632f8-93a4-4caa-b1f7-15619b9538e3', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 1, 0, '2026-05-23T18:57:40.836Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554908' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f68f44fb-9295-474f-87e3-7c9864db446c', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-23T18:57:40.836Z', '2026-05-23T18:57:40.836Z'
FROM matches m WHERE m.external_id = '554901' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '75dbd6c6-62f5-4faa-a61c-72c9e5caf0a5', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554907' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f994b4fb-7bcc-4aba-8422-491981f8bb50', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554909' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0c662720-2a22-48be-9170-77deb923bb87', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554904' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '97ef61eb-a6ca-43f9-921e-5fb83d44b893', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554905' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c279f527-e68d-4cd4-84a8-8fbb0dcd4ca2', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554903' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2ea3ea44-d6f7-4ac6-822a-a07c671c86ba', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 0, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554902' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bbbfd0c2-ef7d-404a-8158-0041e08f92c7', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554906' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5f8c9160-a1f4-492c-b798-09b46064d649', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 3, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554900' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '3902e30f-23c1-45ca-b335-4b83febeb926', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-23T19:34:30.426Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554908' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'be31ce2a-3f24-478f-a1c2-776bf716dff9', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-23T19:34:30.426Z', '2026-05-23T19:34:30.426Z'
FROM matches m WHERE m.external_id = '554901' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '18a6dc39-8cb8-4370-8bd3-75a39817eff0', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 0, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554907' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e47d1145-b9e2-4ca4-a5de-32ffa78ab659', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 3, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554909' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '14410632-1b3b-463e-894c-beb88fb594e5', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 2, 0, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554904' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aed9ab89-b5bf-4b57-a69e-aa0b369ac9df', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554905' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '7e253c33-3ff1-4b2f-93cd-d85aead14a55', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554903' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aac6774c-1342-4410-b532-bce5556962e1', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554902' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4e029561-e20a-4c35-92de-adf11dbc4b1e', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554906' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9f43a3da-9035-46fc-a251-be84e2d30ff9', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554900' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6fbd6448-d514-49b4-9839-2269a8baeb14', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-23T19:57:04.599Z', '2026-05-25T22:21:36.325Z'
FROM matches m WHERE m.external_id = '554908' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4e669d83-9961-467d-ab88-8b173204549e', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-23T19:57:04.599Z', '2026-05-23T19:57:04.599Z'
FROM matches m WHERE m.external_id = '554901' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c142642d-7f12-4336-a876-0c3b82d9540d', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554910' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '301374c9-b5f6-453f-a161-b49d5655f5a9', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 3, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554914' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1416ac56-a112-44c7-bcea-d76a2746ff9d', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554911' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5666f063-c337-453d-9a8b-051b04c93b19', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 3, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554915' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1a426b83-8fbe-42bb-9c1a-0ad4f28a114c', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554918' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'b86cfc22-7f17-43e8-b059-65b4058a09b8', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554912' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '4a3876fb-7077-47af-bd49-94937966e075', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 5, 0, 1, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554916' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a59a81d4-5cae-44f6-8146-b21aa20b0fdd', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554919' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2bce2ca8-bfee-4320-9c67-88d66332bd50', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554913' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'f2b0985c-868b-4250-810e-3702f39ebf25', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 0, 0, '2026-05-30T14:56:01.084Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554917' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'ab50673d-aa2d-46cd-962a-0cf17e56e4b5', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554910' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '2d56eeee-1062-419c-a5ca-91da82d5385f', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554914' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5a658c84-ec7a-49f0-bf53-66faa38b21e8', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554911' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9d7a29bf-05d4-4a0e-9adf-b553b3d89102', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554915' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '0a219227-40b8-4095-a75d-f0747ef73e03', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554918' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'bc939006-f5d8-4232-87bb-fd35ab846295', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 1, 0, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554912' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '562a6929-a744-4972-b54d-63de3a3995aa', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 0, 1, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554916' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c972f056-bded-4bca-b0f0-d9547de51e9c', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 0, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554919' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '9e05938b-5885-474d-aa45-779bc3cd5dd2', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 0, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554913' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'e9be0055-743d-4646-84a9-e05aaae16f41', '15473f3c-bb85-4315-9c13-4e716746a47d', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-30T15:24:23.144Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554917' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '6277d775-0ac2-48a5-9355-6dacded14eca', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 3, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554911' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'fa8855b0-b7f2-459c-bae7-590ec668c49e', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 2, 1, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554915' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '43c6fe03-c8c2-4726-bc55-1b0856872c62', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 3, 0, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554918' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'a601e79b-c091-4855-b48a-f531801ffa60', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 0, 1, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554912' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '5df2eb79-46d5-4a66-9d6d-fd03503fd5c8', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554916' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'c20edd7a-24af-46dd-8109-07df0d3ac591', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 1, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554919' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT 'aa0c4a31-bcc6-45bf-a8fc-0afaf591be08', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 3, 2, 0, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554913' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '37d419f9-d121-4e78-8249-ef077fcc43da', '69478023-3b14-480f-b999-adc02c99816a', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-30T19:08:39.230Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554917' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '16407a7d-c338-4199-b905-49e35a4e1d22', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 2, 0, 0, '2026-05-30T21:29:19.910Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554918' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '55d5d753-ea10-4e33-ac2f-d4984ea16770', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 1, 0, '2026-05-30T21:29:19.910Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554912' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '89d74d75-f0ac-4d61-aa48-a1b6b512b9e2', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 4, 0, 1, 0, '2026-05-30T21:29:19.910Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554916' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '8eb6d6fe-4f80-4274-9d67-1b4ede730f2e', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 0, 1, 3, 0, '2026-05-30T21:29:19.910Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554919' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '78c3fe0e-e468-43bb-81d8-cf11a7ac210b', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 1, 0, 0, 0, '2026-05-30T21:29:19.910Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554913' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, points_awarded, penalty_points, created_at, updated_at)
SELECT '1641e992-e428-4b43-a1d7-ce4fb1a609d0', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'd79438a7-a324-48d0-a245-950aff4d5849', m.id, 2, 1, 1, 0, '2026-05-30T21:29:19.910Z', '2026-06-01T13:27:28.769Z'
FROM matches m WHERE m.external_id = '554917' AND m.provider = 'football-data'
ON CONFLICT (user_id, group_id, match_id) DO NOTHING;
