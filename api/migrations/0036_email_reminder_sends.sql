-- Registro do lembrete diário por e-mail: no máximo um por usuário por dia.
--
-- O lembrete agora sai em qualquer dia com jogo sem palpite, e a mesma consulta
-- devolve os mesmos usuários a cada execução. Sem registro, um disparo duplicado
-- do cron ou uma nova execução manual repete o aviso. A chave primária faz o
-- limite valer no banco, inclusive entre execuções simultâneas: o cron grava a
-- linha antes de enviar e só envia para quem conseguiu gravar.
--
-- `reminder_date` é o dia em horário de Brasília (YYYY-MM-DD). A deduplicação só
-- consulta o dia corrente. O próprio cron apaga as linhas com mais de 7 dias.
CREATE TABLE IF NOT EXISTS email_reminder_sends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, reminder_date)
);
