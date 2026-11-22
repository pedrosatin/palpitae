
CREATE TABLE IF NOT EXISTS competition_radar (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL DEFAULT 'football',
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  -- Como vem do provider ('League' | 'Cup'), sem normalizar: é dado de
  -- observação, não regra de negócio.
  type TEXT,
  logo_url TEXT,
  season TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  -- Artigo da pt.wikipedia que mede o interesse (curadoria manual em
  -- radar/articles.ts). NULL = sem sinal de interesse coletado.
  wiki_article TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_id, season)
);

CREATE INDEX IF NOT EXISTS idx_radar_current ON competition_radar (is_current, country);

-- Série diária por competição. Uma linha por (competição, dia); o cron é
-- idempotente por essa PK — reexecutar no mesmo dia sobrescreve, não duplica.
CREATE TABLE IF NOT EXISTS competition_radar_daily (
  radar_id TEXT NOT NULL REFERENCES competition_radar(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  -- Jogos daquela competição na data (fonte: /fixtures?date=). Sinal de
  -- "está rolando agora" que não custa 1 chamada por liga.
  matches_today INTEGER NOT NULL DEFAULT 0,
  -- Pageviews do artigo na pt.wikipedia. NULL = sem artigo mapeado ou a
  -- Wikimedia ainda não consolidou o dia (atraso de ~1-2 dias).
  pageviews INTEGER,
  PRIMARY KEY (radar_id, day)
);
