-- Estado de silenciamento dos alertas operacionais (ticket 05).
-- Uma linha por tipo de alerta; `last_sent_at` impede repetição a cada tick.
CREATE TABLE ops_alert_state (
  alert_key TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL,
  last_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
