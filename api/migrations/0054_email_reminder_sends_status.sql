-- Estado do lembrete diário para o fallback Mailjet (resiliência 07).
--
-- A reserva começa como `claimed`. O aceite do provedor grava `accepted`.
-- Envio incerto (timeout/5xx) grava `unknown_primary` ou `unknown_fallback` na
-- hora do desfecho, antes de seguir o lote, para uma interrupção não deixar o
-- envio incerto marcado como aceito. Sem MAILJET_API_KEY/SECRET o cron só usa
-- `claimed`/`accepted` (falha libera a reserva; sucesso marca `accepted`).
--
-- `provider` registra quem aceitou (`resend` ou `mailjet`). Linhas antigas
-- migradas ficam com o padrão da coluna no momento do ALTER.

ALTER TABLE email_reminder_sends ADD COLUMN status TEXT NOT NULL DEFAULT 'claimed'
  CHECK (status IN ('claimed', 'accepted', 'unknown_primary', 'unknown_fallback', 'expired'));

ALTER TABLE email_reminder_sends ADD COLUMN provider TEXT
  CHECK (provider IS NULL OR provider IN ('resend', 'mailjet'));
