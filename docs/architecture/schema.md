# Database Schema — Palpitae

> ⚠️ **Reference only.** For the authoritative current schema structure and entity relationships, see [`graphify-out/GRAPH_REPORT.md`](../../graphify-out/GRAPH_REPORT.md) — it's automatically generated from the source code and stays in sync.

**Platform:** Cloudflare D1 (SQLite)
**Migration tool:** Wrangler D1 migrations
**UUID generation:** Application layer (`crypto.randomUUID()`)
**Timestamps:** `TEXT`, ISO 8601 UTC (e.g., `2026-05-02T14:00:00Z`)

---

## Entity Relationship Diagram

```mermaid
erDiagram
    users {
        text id PK
        text email UK
        text provider
        text provider_id
        text created_at
    }
    profiles {
        text user_id PK-FK
        text nickname
        text avatar_url
    }
    competitions {
        text id PK
        text name
        text slug UK
        text external_id
        text provider
        text season
        text status
        text created_at
    }
    teams {
        text id PK
        text name
        text short_name
        text slug
        text logo_url
        text external_id
        text provider
    }
    matches {
        text id PK
        text competition_id FK
        text external_id
        text provider
        text home_team_id FK
        text away_team_id FK
        text start_time
        text status
        integer home_score
        integer away_score
        text phase
        text round
        text created_at
    }
    groups {
        text id PK
        text name
        text competition_id FK
        text owner_user_id FK
        text invite_code UK
        text payment_status
        integer max_members
        text created_at
    }
    group_members {
        text id PK
        text group_id FK
        text user_id FK
        text role
        text joined_at
    }
    predictions {
        text id PK
        text user_id FK
        text group_id FK
        text match_id FK
        integer predicted_home_score
        integer predicted_away_score
        integer points_awarded
        text created_at
        text updated_at
    }
    leaderboard {
        text group_id PK-FK
        text user_id PK-FK
        integer total_points
        integer exact_hits
        text last_updated
    }
    payments {
        text id PK
        text group_id FK
        text user_id FK
        integer amount
        text status
        text provider
        text created_at
    }

    users ||--o| profiles : "has"
    users ||--o{ group_members : "joins"
    users ||--o{ predictions : "makes"
    users ||--o{ leaderboard : "ranked in"
    users ||--o{ payments : "pays"
    competitions ||--o{ matches : "contains"
    competitions ||--o{ groups : "scopes"
    teams ||--o{ matches : "plays home"
    teams ||--o{ matches : "plays away"
    groups ||--o{ group_members : "has"
    groups ||--o{ predictions : "scopes"
    groups ||--o{ leaderboard : "ranks"
    groups ||--o{ payments : "requires"
    matches ||--o{ predictions : "receives"
```

---

## Entities

### `users`

Registered users. One row per Google account.

| Column        | Type        | Notes                 |
| ------------- | ----------- | --------------------- |
| `id`          | TEXT PK     | UUID generated in app |
| `email`       | TEXT UNIQUE | From OAuth provider   |
| `provider`    | TEXT        | e.g., `'google'`      |
| `provider_id` | TEXT        | Provider's user ID    |
| `created_at`  | TEXT        | ISO 8601 UTC          |

Unique constraint: `(provider, provider_id)`

---

### `profiles`

Optional display info. Separated from `users` to keep auth data clean.

| Column       | Type       | Notes                   |
| ------------ | ---------- | ----------------------- |
| `user_id`    | TEXT PK FK | References `users.id`   |
| `nickname`   | TEXT       | Display name (optional) |
| `avatar_url` | TEXT       | Optional                |

---

### `competitions`

A real-world tournament (Brasileirão, Copa 2026, etc.).

| Column        | Type        | Notes                                 |
| ------------- | ----------- | ------------------------------------- |
| `id`          | TEXT PK     | UUID                                  |
| `name`        | TEXT        | e.g., `'Brasileirão 2026'`            |
| `slug`        | TEXT UNIQUE | Used as subdomain: `brasileirao`      |
| `external_id` | TEXT        | Provider's ID for sync                |
| `provider`    | TEXT        | e.g., `'api-football'`                |
| `season`      | TEXT        | e.g., `'2026'`                        |
| `status`      | TEXT        | `upcoming` \| `ongoing` \| `finished` |
| `created_at`  | TEXT        | ISO 8601 UTC                          |

---

### `teams`

Football teams. Provider-agnostic via `external_id + provider`.

| Column        | Type    | Notes              |
| ------------- | ------- | ------------------ |
| `id`          | TEXT PK | UUID               |
| `name`        | TEXT    | Full name          |
| `short_name`  | TEXT    | Abbreviation       |
| `slug`        | TEXT    | URL-safe name      |
| `logo_url`    | TEXT    | Image URL          |
| `external_id` | TEXT    | Provider's team ID |
| `provider`    | TEXT    | Data provider      |

Unique constraint: `(external_id, provider)`

---

### `matches`

A game between two teams within a competition.

| Column           | Type    | Notes                                            |
| ---------------- | ------- | ------------------------------------------------ |
| `id`             | TEXT PK | UUID                                             |
| `competition_id` | TEXT FK | References `competitions.id`                     |
| `external_id`    | TEXT    | Provider's match ID                              |
| `provider`       | TEXT    | Data provider                                    |
| `home_team_id`   | TEXT FK | References `teams.id`                            |
| `away_team_id`   | TEXT FK | References `teams.id`                            |
| `start_time`     | TEXT    | ISO 8601 UTC — **the prediction lock boundary**  |
| `status`         | TEXT    | `scheduled` \| `live` \| `finished`              |
| `home_score`     | INTEGER | `NULL` until finished                            |
| `away_score`     | INTEGER | `NULL` until finished                            |
| `phase`          | TEXT    | `group` \| `round_of_16` \| `quarter_final` etc. |
| `round`          | TEXT    | e.g., `'Rodada 5'`, `'Matchday 3'`               |
| `created_at`     | TEXT    | ISO 8601 UTC                                     |

Unique constraint: `(external_id, provider)`

> **Prediction lock rule:** A prediction for this match is editable only while `now() < start_time`. No `locked_at` column is stored on `predictions` (ADR-004).

---

### `groups`

A private competition created by a user for a specific competition.

| Column           | Type        | Notes                            |
| ---------------- | ----------- | -------------------------------- |
| `id`             | TEXT PK     | UUID                             |
| `name`           | TEXT        | Display name                     |
| `competition_id` | TEXT FK     | References `competitions.id`     |
| `owner_user_id`  | TEXT FK     | References `users.id`            |
| `invite_code`    | TEXT UNIQUE | Public join link token           |
| `payment_status` | TEXT        | `pending` \| `paid` \| `expired` |
| `max_members`    | INTEGER     | Default 50, max 50               |
| `created_at`     | TEXT        | ISO 8601 UTC                     |

---

### `group_members`

Users in a group.

| Column      | Type    | Notes                  |
| ----------- | ------- | ---------------------- |
| `id`        | TEXT PK | UUID                   |
| `group_id`  | TEXT FK | References `groups.id` |
| `user_id`   | TEXT FK | References `users.id`  |
| `role`      | TEXT    | `owner` \| `member`    |
| `joined_at` | TEXT    | ISO 8601 UTC           |

Unique constraint: `(group_id, user_id)`

---

### `predictions`

A user's score prediction for a match within a group.

| Column                 | Type    | Notes                               |
| ---------------------- | ------- | ----------------------------------- |
| `id`                   | TEXT PK | UUID                                |
| `user_id`              | TEXT FK | References `users.id`               |
| `group_id`             | TEXT FK | References `groups.id`              |
| `match_id`             | TEXT FK | References `matches.id`             |
| `predicted_home_score` | INTEGER |                                     |
| `predicted_away_score` | INTEGER |                                     |
| `points_awarded`       | INTEGER | Default 0; set after match finishes |
| `created_at`           | TEXT    | ISO 8601 UTC                        |
| `updated_at`           | TEXT    | ISO 8601 UTC                        |

Unique constraint: `(user_id, group_id, match_id)` — one prediction per user per match per group.

---

### `leaderboard`

Materialized ranking per group. Updated when matches finish or scores change.

| Column         | Type       | Notes                                      |
| -------------- | ---------- | ------------------------------------------ |
| `group_id`     | TEXT PK FK | References `groups.id`                     |
| `user_id`      | TEXT PK FK | References `users.id`                      |
| `total_points` | INTEGER    | Accumulated score                          |
| `exact_hits`   | INTEGER    | Count of 3-point predictions (tie-breaker) |
| `last_updated` | TEXT       | ISO 8601 UTC                               |

Composite PK: `(group_id, user_id)`

> Tie-breaker order: total_points → exact_hits → earliest prediction `updated_at` (queried from `predictions` table when needed).

---

### `payments`

Payment records. One per group creation (admin pays).

| Column       | Type    | Notes                           |
| ------------ | ------- | ------------------------------- |
| `id`         | TEXT PK | UUID                            |
| `group_id`   | TEXT FK | References `groups.id`          |
| `user_id`    | TEXT FK | References `users.id`           |
| `amount`     | INTEGER | In centavos (BRL)               |
| `status`     | TEXT    | `pending` \| `paid` \| `failed` |
| `provider`   | TEXT    | Payment provider name           |
| `created_at` | TEXT    | ISO 8601 UTC                    |

---

### `competition_radar` / `competition_radar_daily`

Snapshot diário do radar de competições (migration 0014, ADR-014). **Fora do
domínio do produto**: nada aqui alimenta grupos, jogos ou palpites — é insumo do
dashboard admin `/admin/oportunidades`, e por isso não tem FK para
`competitions`. Escrito pelo cron `radar/sync.ts`.

`competition_radar` — uma linha por (provider, competição, temporada):

| Column        | Type       | Notes                                                        |
| ------------- | ---------- | ------------------------------------------------------------ |
| `id`          | TEXT PK    | Determinístico: `provider:external_id:season`                 |
| `sport`       | TEXT       | `football` hoje; a tabela já nasce multi-esporte              |
| `provider`    | TEXT       | `api-football` (não é o provider do produto)                  |
| `external_id` | TEXT       | Id da liga no provider                                        |
| `name`        | TEXT       | Nome no provider (`CONMEBOL Libertadores`)                    |
| `country`     | TEXT       | `World` para torneios internacionais                          |
| `type`        | TEXT       | `League` \| `Cup`, como vem do provider                       |
| `season`      | TEXT       | Ano da temporada corrente                                     |
| `starts_on` / `ends_on` | TEXT | Janela do torneio (YYYY-MM-DD); deriva o status          |
| `is_current`  | INTEGER    | Reconstruído a cada sync — saiu do catálogo, deixa de valer   |
| `wiki_article`| TEXT       | Artigo canônico da pt.wikipedia; NULL = sem sinal de interesse |
| `last_seen_at`| TEXT       | Frescor do snapshot (a UI avisa se passar de 30h)             |

`competition_radar_daily` — série diária, PK `(radar_id, day)`:

| Column          | Type    | Notes                                                    |
| --------------- | ------- | -------------------------------------------------------- |
| `matches_today` | INTEGER | Jogos da competição naquela data (oferta)                 |
| `pageviews`     | INTEGER | Acessos ao artigo na pt.wikipedia (interesse); NULL se não coletado |

---

## Scoring Rules (encoded in application logic)

| Result                          | Points |
| ------------------------------- | ------ |
| Exact score                     | 3      |
| Correct outcome (win/draw/loss) | 1      |
| Wrong                           | 0      |

---

## Initial Migration SQL

> File: `migrations/0001_initial_schema.sql`

```sql
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
```
