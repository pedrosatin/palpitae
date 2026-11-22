CREATE TABLE provider_rate_state (
  provider TEXT PRIMARY KEY,
  -- Identificador da credencial (sem o valor do segredo), para quando um
  -- provedor ganhar mais de uma chave.
  credential TEXT NOT NULL DEFAULT 'default',
  -- Identificador da janela de um minuto (`floor(now / 60000)`).
  window_started_at INTEGER NOT NULL DEFAULT 0,
  -- Tentativas reservadas na janela atual.
  window_calls INTEGER NOT NULL DEFAULT 0,
  -- Nada sai para o provedor antes deste instante (429/cota zerada).
  blocked_until INTEGER NOT NULL DEFAULT 0,
  -- Última cota que uma resposta informou, para diagnóstico (medição fica no
  -- Analytics Engine, em `provider_http_attempt`).
  last_remaining INTEGER,
  last_reset_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO provider_rate_state (provider, credential) VALUES ('football-data', 'default');

CREATE TABLE provider_work (
  provider TEXT NOT NULL,
  -- 'result' (poller, janela ativa e resgate), 'late' (varredura de atrasados),
  -- 'manual' (sync administrativo) e 'discovery' (descoberta diária).
  kind TEXT NOT NULL,
  competition_code TEXT NOT NULL,
  -- Id interno da competição no D1, quando o produtor o sabe (telemetria).
  competition_id TEXT NOT NULL DEFAULT '',
  season TEXT NOT NULL,
  -- Rodada football-data; vazio quando o sync busca a temporada inteira.
  round TEXT NOT NULL DEFAULT '',
  -- Menor executa antes: resultado 0, varredura e manual 1, descoberta 2.
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  -- Não executar antes deste instante (backoff de falha, reset de 429).
  not_before INTEGER NOT NULL DEFAULT 0,
  -- Execução em curso: quem reclamou e até quando (lease).
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, kind, competition_code, season, round)
);

CREATE INDEX IF NOT EXISTS idx_provider_work_ready
  ON provider_work(provider, not_before, priority);
