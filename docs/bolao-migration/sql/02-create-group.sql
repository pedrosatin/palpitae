-- Fase 2 — Grupo "Bolão Brasileirão" + 6 membros.
-- Pré-requisito: Fase 1 aplicada (competição 06baa1de-…). Não depende dos jogos.
-- Config espelha o bolão antigo: 3 exato / 1 resultado, sem bônus de pênalti (liga),
-- visibilidade 'hidden' (= regra anti-cópia; equivale ao cutoff do bolão).
--
-- Aplicar com:
--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/02-create-group.sql

INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code,
                    points_exact, points_winner, points_penalty, predictions_visibility)
VALUES (
  'd79438a7-a324-48d0-a245-950aff4d5849',
  'Bolão Brasileirão',
  '06baa1de-01c3-4e71-ac6e-a850fa690ec1',
  '7c13016e-5ae7-4e35-acc2-f6115dc94c1c',  -- Pedro Satin (owner)
  '69TL-RH2U',
  3, 1, 0, 'hidden'
);

INSERT INTO group_members (id, group_id, user_id, role) VALUES
  ('5d6e85db-cf05-4f3c-9179-04e2a37a6fe3', 'd79438a7-a324-48d0-a245-950aff4d5849', '7c13016e-5ae7-4e35-acc2-f6115dc94c1c', 'owner'),   -- satin
  ('7879f61c-7fb4-4042-8b9e-dadda7fdcbc7', 'd79438a7-a324-48d0-a245-950aff4d5849', '69478023-3b14-480f-b999-adc02c99816a', 'member'),  -- Chu / Caio
  ('2d107279-922a-4254-85dd-ef99280943cd', 'd79438a7-a324-48d0-a245-950aff4d5849', 'e1072bec-d62d-439f-9e49-31ea92c02ce4', 'member'),  -- FABRE / Daniel
  ('aa00e118-df27-4faf-af65-62b068916584', 'd79438a7-a324-48d0-a245-950aff4d5849', 'd34b5d2e-00ee-4802-bff4-2272b03380e9', 'member'),  -- PDR / Pedro Lucas
  ('bac652b0-4e84-42a7-bf11-be9ac657b8a1', 'd79438a7-a324-48d0-a245-950aff4d5849', '482b2145-dc50-4a8e-8e15-293ea6af4e60', 'member'),  -- WEEGEE / Gustavo
  ('7d2c4d00-a949-40b8-a9c1-5c81b17b02e1', 'd79438a7-a324-48d0-a245-950aff4d5849', '15473f3c-bb85-4315-9c13-4e716746a47d', 'member'); -- Isa / Isabelly
