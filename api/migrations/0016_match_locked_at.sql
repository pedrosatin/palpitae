ALTER TABLE matches ADD COLUMN locked_at TEXT;

UPDATE matches
   SET locked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE locked_at IS NULL
   AND status IN ('live', 'finished');
