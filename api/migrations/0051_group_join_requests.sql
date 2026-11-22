
ALTER TABLE groups ADD COLUMN public_id TEXT;
ALTER TABLE groups ADD COLUMN join_requests_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (join_requests_enabled IN (0, 1));

UPDATE groups
SET public_id = lower(hex(randomblob(16)))
WHERE public_id IS NULL;

CREATE TRIGGER groups_public_id_insert AFTER INSERT ON groups
WHEN NEW.public_id IS NULL
BEGIN
  UPDATE groups SET public_id = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_public_id ON groups(public_id);

CREATE TABLE IF NOT EXISTS group_join_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Um pedido pendente por usuário e grupo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_join_requests_pending
  ON group_join_requests(group_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_group_join_requests_group_status
  ON group_join_requests(group_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_group_join_requests_user_day
  ON group_join_requests(user_id, created_at);
