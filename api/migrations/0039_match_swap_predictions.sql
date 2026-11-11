-- Mando invertido pelo provedor: o palpite acompanha os times.
--
-- O palpite guarda o placar por posição (casa e fora). Quando o provedor corrige
-- o mando de um jogo já gravado, o upsert do sync (MATCH_UPSERT_SQL) troca
-- home_team_id e away_team_id. Sem inverter o palpite junto, o "Chelsea 2x1" que
-- a pessoa marcou passaria a valer como vitória do adversário por 2x1. O vencedor
-- dos pênaltis previsto também troca de lado.
--
-- O gatilho roda dentro da mesma instrução do upsert. A inversão acontece uma vez
-- por troca de mando, mesmo com dois syncs concorrentes, e um sync repetido sem
-- mudança não grava a linha do jogo, então não dispara o gatilho.
--
-- Só a troca exata de mando inverte o palpite. Quando o provedor substitui um dos
-- times, o palpite fica como está.
--
-- Os pontos não mudam aqui: o upsert zera scored_at do jogo e a pontuação refaz os
-- pontos e o ranking com o palpite invertido.
CREATE TRIGGER IF NOT EXISTS matches_swap_predictions
AFTER UPDATE OF home_team_id, away_team_id ON matches
WHEN NEW.home_team_id = OLD.away_team_id AND NEW.away_team_id = OLD.home_team_id
BEGIN
  UPDATE predictions
     SET predicted_home_score = predicted_away_score,
         predicted_away_score = predicted_home_score,
         predicted_penalty_winner = CASE predicted_penalty_winner
                                      WHEN 'home' THEN 'away'
                                      WHEN 'away' THEN 'home'
                                    END
   WHERE match_id = NEW.id;
END;
