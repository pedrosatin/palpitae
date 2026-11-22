CREATE TABLE IF NOT EXISTS email_reminder_sends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, reminder_date)
);
