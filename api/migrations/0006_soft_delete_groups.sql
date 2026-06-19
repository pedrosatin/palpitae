-- Soft delete for groups: deleted groups are hidden from listings/detail
-- but their data (members, predictions, leaderboard) is retained.
ALTER TABLE groups ADD COLUMN deleted_at TEXT;
