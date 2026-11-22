ALTER TABLE competitions ADD COLUMN type TEXT NOT NULL DEFAULT 'cup' CHECK (type IN ('league', 'cup'));

UPDATE competitions SET type = 'league' WHERE slug = 'campeonato-brasileiro-serie-a-2026';
