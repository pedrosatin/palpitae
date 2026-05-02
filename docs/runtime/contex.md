# Runtime Context

-- =========================
-- EXTENSIONS
-- =========================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================
-- USERS & AUTH
-- =========================
CREATE TABLE users (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
email TEXT NOT NULL UNIQUE,
provider TEXT NOT NULL, -- 'google'
provider_id TEXT NOT NULL,
created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

```
UNIQUE (provider, provider_id)
```

);

CREATE TABLE profiles (
user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
nickname TEXT,
avatar_url TEXT
);

-- =========================
-- COMPETITIONS & TEAMS
-- =========================
CREATE TABLE competitions (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
name TEXT NOT NULL,
slug TEXT NOT NULL UNIQUE, -- usado no subdomínio
external_id TEXT,
provider TEXT,
season TEXT,
status TEXT NOT NULL, -- 'upcoming', 'ongoing', 'finished'
created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE teams (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
name TEXT NOT NULL,
short_name TEXT,
slug TEXT NOT NULL,
logo_url TEXT,
external_id TEXT,
provider TEXT,

```
UNIQUE (external_id, provider)
```

);

-- =========================
-- MATCHES
-- =========================
CREATE TABLE matches (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,

```
external_id TEXT NOT NULL,
provider TEXT NOT NULL,

home_team_id UUID NOT NULL REFERENCES teams(id),
away_team_id UUID NOT NULL REFERENCES teams(id),

start_time TIMESTAMP WITH TIME ZONE NOT NULL,
status TEXT NOT NULL, -- 'scheduled', 'live', 'finished'

home_score INT,
away_score INT,

phase TEXT, -- 'group', 'round_of_16', etc.

created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

UNIQUE (external_id, provider)
```

);

CREATE INDEX idx_matches_competition ON matches(competition_id);
CREATE INDEX idx_matches_start_time ON matches(start_time);
CREATE INDEX idx_matches_status ON matches(status);

-- =========================
-- GROUPS
-- =========================
CREATE TABLE groups (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
name TEXT NOT NULL,
competition_id UUID NOT NULL REFERENCES competitions(id),

```
owner_user_id UUID NOT NULL REFERENCES users(id),

invite_code TEXT NOT NULL UNIQUE,

payment_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'expired'

max_members INT NOT NULL DEFAULT 50 CHECK (max_members <= 50),
created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
```

);

CREATE INDEX idx_groups_competition ON groups(competition_id);

-- =========================
-- GROUP MEMBERS
-- =========================
CREATE TABLE group_members (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

```
role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'member'
joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

UNIQUE (group_id, user_id)
```

);

CREATE INDEX idx_group_members_group ON group_members(group_id);

-- =========================
-- PREDICTIONS
-- =========================
CREATE TABLE predictions (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

```
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

predicted_home_score INT NOT NULL,
predicted_away_score INT NOT NULL,

points_awarded INT DEFAULT 0,

created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

locked_at TIMESTAMP WITH TIME ZONE,

UNIQUE (user_id, group_id, match_id)
```

);

CREATE INDEX idx_predictions_group ON predictions(group_id);
CREATE INDEX idx_predictions_match ON predictions(match_id);

-- =========================
-- LEADERBOARD (MATERIALIZED)
-- =========================
CREATE TABLE leaderboard (
group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

```
total_points INT NOT NULL DEFAULT 0,
exact_hits INT NOT NULL DEFAULT 0,

last_updated TIMESTAMP WITH TIME ZONE DEFAULT now(),

PRIMARY KEY (group_id, user_id)
```

);

CREATE INDEX idx_leaderboard_group ON leaderboard(group_id);

-- =========================
-- PAYMENTS
-- =========================
CREATE TABLE payments (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

```
group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
user_id UUID NOT NULL REFERENCES users(id),

amount INT NOT NULL, -- em centavos

status TEXT NOT NULL, -- 'pending', 'paid', 'failed'
provider TEXT,

created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
```

);

CREATE INDEX idx_payments_group ON payments(group_id);
