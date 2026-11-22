CREATE INDEX IF NOT EXISTS idx_group_members_user
  ON group_members(user_id, group_id);
