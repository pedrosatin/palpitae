-- Fase 2 — Grupo "Bolão Brasileirão" + 6 membros.
-- Pré-requisito: Fase 1 aplicada (competição 06baa1de-…). Não depende dos jogos.
-- Config espelha o bolão antigo: 3 exato / 1 resultado, sem bônus de pênalti (liga),
-- visibilidade 'hidden' (= regra anti-cópia; equivale ao cutoff do bolão).
--
-- Os valores entre <...> são placeholders: os IDs reais e o código de convite
-- ficam fora do repositório. Gere o convite no formato XXXX-XXXX (o mesmo de
-- generateInviteCode em api/src/groups/router.ts).
--
-- Aplicar com:
--   npx wrangler d1 execute palpitae --remote --file docs/bolao-migration/sql/02-create-group.sql

INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code,
                    points_exact, points_winner, points_penalty, predictions_visibility)
VALUES (
  '<GROUP_ID>',
  'Bolão Brasileirão',
  '06baa1de-01c3-4e71-ac6e-a850fa690ec1',
  '<USER_ID_A>',  -- dono do grupo (Jogador A)
  '<INVITE_CODE>',
  3, 1, 0, 'hidden'
);

INSERT INTO group_members (id, group_id, user_id, role) VALUES
  (lower(hex(randomblob(16))), '<GROUP_ID>', '<USER_ID_A>', 'owner'),   -- Jogador A
  (lower(hex(randomblob(16))), '<GROUP_ID>', '<USER_ID_B>', 'member'),  -- Jogador B
  (lower(hex(randomblob(16))), '<GROUP_ID>', '<USER_ID_C>', 'member'),  -- Jogador C
  (lower(hex(randomblob(16))), '<GROUP_ID>', '<USER_ID_D>', 'member'),  -- Jogador D
  (lower(hex(randomblob(16))), '<GROUP_ID>', '<USER_ID_E>', 'member'),  -- Jogador E
  (lower(hex(randomblob(16))), '<GROUP_ID>', '<USER_ID_F>', 'member'); -- Jogador F
