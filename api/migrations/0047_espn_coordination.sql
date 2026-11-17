-- Coordenação da ESPN no orçamento compartilhado e na fila durável (ADR-027,
-- adendo do ticket 03 da resiliência).
--
-- provider_rate_state ganha a linha da ESPN e as colunas do controle de acesso:
-- - forbidden_streak: 403 seguidos (sem sucesso no meio). Cada 403 fora de
--   bloqueio sobe a sequência e espaça a nova tentativa (15 min, 1 h, 6 h); a
--   resposta de sucesso zera.
-- - suspended_at / suspended_reason: a coleta fica suspensa quando a ESPN
--   proíbe o acesso (401, 451 ou 403 repetido além do limite). Nenhum
--   isolate chama o provedor enquanto `suspended_at` não for NULL, e só uma
--   decisão do operador (conferir os termos e a autorização) a retoma.
--
-- Só acrescenta colunas com padrão e uma linha: o Worker anterior continua no
-- ar durante o deploy sem enxergá-las.
ALTER TABLE provider_rate_state ADD COLUMN forbidden_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_rate_state ADD COLUMN suspended_at INTEGER;
ALTER TABLE provider_rate_state ADD COLUMN suspended_reason TEXT;

INSERT OR IGNORE INTO provider_rate_state (provider, credential) VALUES ('espn', 'public');
