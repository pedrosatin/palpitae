-- Papel de dono em `group_members` mantido a partir de `groups.owner_user_id`.
--
-- A autorização das ações de dono lê `groups.owner_user_id`, e a lista de membros
-- mostra o selo e o botão de remover a partir de `group_members.role`. Nada ligava
-- os dois: trocar o dono do grupo à mão, ou na exclusão de conta, deixava a interface
-- mostrando o dono antigo. A partir desta migration `role` é derivado do dono do
-- grupo: 'owner' para `owner_user_id` e 'member' para os demais.
--
-- Os gatilhos corrigem o valor em vez de recusar, então o Worker anterior, que grava
-- 'owner' na criação e 'member' na entrada, segue funcionando (expand). A recursão de
-- gatilhos fica desligada no SQLite e no D1, e o UPDATE interno não dispara de novo.
--
-- Reversão. Reverter o código mantém os gatilhos. Desligá-los exige uma migration
-- com `DROP TRIGGER`; o papel gravado continua coerente com o dono.

UPDATE group_members
   SET role = CASE WHEN user_id = (SELECT owner_user_id FROM groups WHERE id = group_members.group_id)
                   THEN 'owner' ELSE 'member' END
 WHERE role IS NOT CASE WHEN user_id = (SELECT owner_user_id FROM groups WHERE id = group_members.group_id)
                        THEN 'owner' ELSE 'member' END;

CREATE TRIGGER IF NOT EXISTS groups_owner_role_sync AFTER UPDATE OF owner_user_id ON groups
WHEN NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN
  UPDATE group_members
     SET role = CASE WHEN user_id = NEW.owner_user_id THEN 'owner' ELSE 'member' END
   WHERE group_id = NEW.id
     AND role IS NOT CASE WHEN user_id = NEW.owner_user_id THEN 'owner' ELSE 'member' END;
END;

CREATE TRIGGER IF NOT EXISTS group_members_role_insert AFTER INSERT ON group_members
WHEN NEW.role IS NOT CASE WHEN NEW.user_id = (SELECT owner_user_id FROM groups WHERE id = NEW.group_id)
                          THEN 'owner' ELSE 'member' END
BEGIN
  UPDATE group_members
     SET role = CASE WHEN NEW.user_id = (SELECT owner_user_id FROM groups WHERE id = NEW.group_id)
                     THEN 'owner' ELSE 'member' END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS group_members_role_update AFTER UPDATE OF role, user_id, group_id ON group_members
WHEN NEW.role IS NOT CASE WHEN NEW.user_id = (SELECT owner_user_id FROM groups WHERE id = NEW.group_id)
                          THEN 'owner' ELSE 'member' END
BEGIN
  UPDATE group_members
     SET role = CASE WHEN NEW.user_id = (SELECT owner_user_id FROM groups WHERE id = NEW.group_id)
                     THEN 'owner' ELSE 'member' END
   WHERE id = NEW.id;
END;
