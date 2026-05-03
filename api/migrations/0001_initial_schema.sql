PRAGMA foreign_keys = ON;

-- Users & Auth
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  avatar_url TEXT
);

-- Competitions & Teams
CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  external_id TEXT,
  provider TEXT,
  season TEXT,
  status TEXT NOT NULL CHECK (status IN ('upcoming', 'ongoing', 'finished')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT,
  slug TEXT NOT NULL,
  logo_url TEXT,
  external_id TEXT,
  provider TEXT,
  UNIQUE (external_id, provider)
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  home_team_id TEXT NOT NULL REFERENCES teams(id),
  away_team_id TEXT NOT NULL REFERENCES teams(id),
  start_time TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'finished')),
  home_score INTEGER,
  away_score INTEGER,
  phase TEXT,
  round TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (external_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(competition_id);
CREATE INDEX IF NOT EXISTS idx_matches_start_time ON matches(start_time);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT NOT NULL UNIQUE,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'expired')),
  max_members INTEGER NOT NULL DEFAULT 50 CHECK (max_members <= 50),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_groups_competition ON groups(competition_id);

-- Group Members
CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

-- Predictions
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  predicted_home_score INTEGER NOT NULL,
  predicted_away_score INTEGER NOT NULL,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, group_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_group ON predictions(group_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);

-- Leaderboard (Materialized)
CREATE TABLE IF NOT EXISTS leaderboard (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_points INTEGER NOT NULL DEFAULT 0,
  exact_hits INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_group ON leaderboard(group_id);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_group ON payments(group_id);
