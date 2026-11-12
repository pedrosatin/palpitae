-- Formato de `matches` imposto pelo banco.
--
-- O travamento do palpite compara `start_time` com o relógio como texto
-- (`lockedSql`, ADR-004). Só funciona se todo `start_time` estiver em
-- `YYYY-MM-DDTHH:MM:SSZ`: um '2026-11-09 20:00:00' fica sempre "antes" de qualquer
-- ISO do mesmo dia, e um horário com milissegundos não é comparável ao segundo
-- exato. A pontuação só alcança jogo `finished` com placar completo, e a lista de
-- rodadas agrupa por `round`. Os dois provedores já gravam nesse formato; estes
-- gatilhos fazem o banco recusar um provedor novo, ou um sync alterado, que grave
-- fora dele.
--
-- Gatilho e não CHECK: acrescentar CHECK a uma coluna existente exige rebuild da
-- tabela, e apagar a tabela antiga no rebuild levaria os palpites em cascata (ADR-013).
--
-- O formato vale quando `strftime` devolve o próprio valor: data inexistente vira
-- NULL ou outra data, e espaço no lugar do T, fuso ou milissegundos mudam o texto.
-- GLOB com classes de caracteres não serve: o D1 recusa padrão longo.
--
-- Na atualização, cada regra só olha a coluna que mudou. Uma linha antiga fora do
-- formato continua aceitando as gravações que não mexem nela (scored_at,
-- locked_at, o upsert que preserva o start_time de um adiado), e o gatilho não
-- trava o sync por causa de um dado que ele não escreveu. Contagem antes de aplicar:
--   SELECT
--     (SELECT COUNT(*) FROM matches
--       WHERE strftime('%Y-%m-%dT%H:%M:%SZ', start_time) IS NOT start_time) AS horario,
--     (SELECT COUNT(*) FROM matches
--       WHERE status = 'finished' AND (home_score IS NULL OR away_score IS NULL)) AS sem_placar,
--     (SELECT COUNT(*) FROM matches WHERE round IS NULL) AS sem_rodada;
-- Em 12/11/2026 voltou 0, 0 e 0 em produção (4050 jogos).
--
-- Só cria gatilhos: o Worker anterior grava nesse formato e continua funcionando
-- durante o deploy. O revert é remover os dois gatilhos, numa migration nova.
CREATE TRIGGER IF NOT EXISTS matches_format_insert
BEFORE INSERT ON matches
BEGIN
  SELECT RAISE(ABORT, 'matches.start_time fora do formato YYYY-MM-DDTHH:MM:SSZ')
   WHERE strftime('%Y-%m-%dT%H:%M:%SZ', NEW.start_time) IS NOT NEW.start_time;
  SELECT RAISE(ABORT, 'matches: jogo finished sem placar')
   WHERE NEW.status = 'finished' AND (NEW.home_score IS NULL OR NEW.away_score IS NULL);
  SELECT RAISE(ABORT, 'matches.round nulo')
   WHERE NEW.round IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS matches_format_update
BEFORE UPDATE OF start_time, status, home_score, away_score, round ON matches
BEGIN
  SELECT RAISE(ABORT, 'matches.start_time fora do formato YYYY-MM-DDTHH:MM:SSZ')
   WHERE NEW.start_time IS NOT OLD.start_time
     AND strftime('%Y-%m-%dT%H:%M:%SZ', NEW.start_time) IS NOT NEW.start_time;
  SELECT RAISE(ABORT, 'matches: jogo finished sem placar')
   WHERE NEW.status = 'finished' AND (NEW.home_score IS NULL OR NEW.away_score IS NULL)
     AND (OLD.status IS NOT 'finished'
          OR NEW.home_score IS NOT OLD.home_score
          OR NEW.away_score IS NOT OLD.away_score);
  SELECT RAISE(ABORT, 'matches.round nulo')
   WHERE NEW.round IS NULL AND OLD.round IS NOT NULL;
END;
