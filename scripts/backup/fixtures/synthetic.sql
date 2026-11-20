-- Synthetic Palpitae D1 dump for isolated backup/restore rehearsal.
-- Contains only fake identifiers. Never replace with production export.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  status TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL
);

INSERT INTO users (id, email, provider, provider_id, created_at) VALUES
  ('user_syn_1', 'alice.synthetic@example.test', 'google', 'syn-google-1', '2026-01-01 12:00:00'),
  ('user_syn_2', 'bob.synthetic@example.test', 'google', 'syn-google-2', '2026-01-02 12:00:00');

INSERT INTO competitions (id, name, slug, status) VALUES
  ('comp_syn_1', 'Synthetic League', 'synthetic-league-2026', 'ongoing');

INSERT INTO teams (id, name, slug) VALUES
  ('team_syn_home', 'Synthetic Home FC', 'synthetic-home'),
  ('team_syn_away', 'Synthetic Away United', 'synthetic-away');

INSERT INTO matches (id, competition_id, home_team_id, away_team_id, start_time, status, home_score, away_score) VALUES
  ('match_syn_1', 'comp_syn_1', 'team_syn_home', 'team_syn_away', '2026-03-01T19:00:00Z', 'finished', 2, 1),
  ('match_syn_2', 'comp_syn_1', 'team_syn_away', 'team_syn_home', '2026-03-08T19:00:00Z', 'scheduled', NULL, NULL);

INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
  ('group_syn_1', 'Bolão Sintético', 'comp_syn_1', 'user_syn_1', 'SYNCODE1');

INSERT INTO predictions (id, group_id, user_id, match_id, home_score, away_score) VALUES
  ('pred_syn_1', 'group_syn_1', 'user_syn_1', 'match_syn_1', 2, 1),
  ('pred_syn_2', 'group_syn_1', 'user_syn_2', 'match_syn_1', 1, 1),
  ('pred_syn_3', 'group_syn_1', 'user_syn_1', 'match_syn_2', 0, 0);

PRAGMA foreign_keys = ON;
