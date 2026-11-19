-- Estado do lembrete diário para o fallback Mailjet (resiliência 07).
--
-- Sem MAILJET_API_KEY/SECRET o cron só grava linhas com o padrão `accepted`
-- (comportamento anterior: presença da linha = aceite ou reserva ainda não
-- liberada). Com o fallback ligado, envio incerto (timeout/5xx) grava
-- `unknown_primary` ou `unknown_fallback` e mantém a linha para reconciliar
-- pelo CustomID, sem reenviar às cegas.
--
-- `provider` registra quem aceitou (`resend` ou `mailjet`). Linhas antigas
-- ficam com status `accepted` e provider NULL.

ALTER TABLE email_reminder_sends ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'
  CHECK (status IN ('accepted', 'unknown_primary', 'unknown_fallback', 'expired'));

ALTER TABLE email_reminder_sends ADD COLUMN provider TEXT
  CHECK (provider IS NULL OR provider IN ('resend', 'mailjet'));
