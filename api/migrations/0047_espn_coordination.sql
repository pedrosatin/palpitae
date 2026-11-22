ALTER TABLE provider_rate_state ADD COLUMN forbidden_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_rate_state ADD COLUMN suspended_at INTEGER;
ALTER TABLE provider_rate_state ADD COLUMN suspended_reason TEXT;

INSERT OR IGNORE INTO provider_rate_state (provider, credential) VALUES ('espn', 'public');
