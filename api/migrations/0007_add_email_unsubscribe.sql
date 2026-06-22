-- Opt-out de e-mails de lembrete de rodada (LGPD). NULL = inscrito (default opt-in);
-- preenchido com o instante em que o usuário cancelou a inscrição. Reativar volta a NULL.
ALTER TABLE users ADD COLUMN email_unsubscribed_at TEXT;
