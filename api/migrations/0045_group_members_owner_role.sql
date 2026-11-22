
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
