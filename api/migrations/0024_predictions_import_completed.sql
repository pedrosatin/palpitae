ALTER TABLE group_members ADD COLUMN predictions_import_completed INTEGER NOT NULL DEFAULT 0
  CHECK (predictions_import_completed IN (0, 1));
