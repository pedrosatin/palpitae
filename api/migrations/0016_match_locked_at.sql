-- Instante em que o sync viu o jogo iniciado pela primeira vez.
--
-- O palpite trava pelo horário enquanto o jogo não está adiado. Quando o provider
-- marca o jogo como SUSPENDED/POSTPONED/CANCELLED depois do início, o sync grava
-- `postponed = 1` e o status volta para 'scheduled', o que destravava palpites já
-- revelados aos outros membros. `locked_at` é gravado quando o provider indica que o
-- jogo começou (IN_PLAY, PAUSED, LIVE, SUSPENDED, FINISHED, AWARDED) ou quando o
-- status local já é 'live'/'finished', e nunca é apagado: com ele preenchido, o
-- palpite fica travado para sempre, mesmo que o status ou o horário mudem.
--
-- Horário vencido sozinho não grava `locked_at`: um adiamento percebido depois do
-- horário original, sem o jogo ter começado, continua reabrindo o palpite.
--
-- Backfill pela mesma regra: só jogos com status 'live' ou 'finished'. O valor do
-- backfill é o instante da migração, não o horário em que a bola rolou.
ALTER TABLE matches ADD COLUMN locked_at TEXT;

UPDATE matches
   SET locked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE locked_at IS NULL
   AND status IN ('live', 'finished');
