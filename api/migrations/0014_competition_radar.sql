-- Radar de competições — inteligência de produto para decidir QUAIS campeonatos
-- vale a pena incorporar ao Palpitae. Nada aqui alimenta o produto: é insumo do
-- dashboard admin (/admin/oportunidades).
--
-- Duas perguntas, duas fontes (ver api/src/radar/):
--   1. "o que está acontecendo agora?" → API-Football (api-sports.io), catálogo
--      de ligas com temporada corrente + jogos do dia. Cobertura ~1.200 ligas,
--      contra as 12 do football-data.org que já usamos pro produto.
--   2. "o que o brasileiro acompanha?" → pageviews diários da pt.wikipedia
--      (Wikimedia Pageviews API). Proxy grátis e comparável de interesse do
--      público BR — o Google Trends não tem API pública utilizável.
--
-- Snapshot diário via cron: a dashboard lê só o D1, nunca as APIs externas.

CREATE TABLE IF NOT EXISTS competition_radar (
  id TEXT PRIMARY KEY,
  -- Genérico desde já: hoje só 'football', mas o desenho não muda quando
  -- entrarem NBA/NFL/F1 (outro provider, mesma tabela).
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
  -- 1 = provider marcou a temporada como corrente no último sync.
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
