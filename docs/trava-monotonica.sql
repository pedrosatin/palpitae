-- Investigação de palpites alterados após o kickoff original em grupos ocultos.
-- Somente leitura. Execute com a conexão de produção do operador.
--
-- Substitua o JSON vazio por horários originais obtidos de backup ou histórico
-- do provedor. Cada objeto tem match_id e start_time_original em UTC ISO 8601.
-- Para jogos hoje adiados, start_time preserva o último horário conhecido e serve
-- como aproximação. Remarcações sobrescrevem start_time e o banco não guarda
-- histórico de kickoff. Sem a entrada histórica, a consulta não identifica todos
-- os remarcados nem garante que o horário atual do adiado seja o original.
--
-- updated_at guarda apenas a última escrita do palpite. PUT, bulk e replicate
-- o atualizam mesmo ao reenviar o mesmo placar. Importação usa a mesma gravação
-- do replicate. Pontuação e inversão de mando pelo gatilho 0039 não o atualizam.
-- Portanto o resultado aponta candidatos, sem provar cópia ou mudança de placar.
-- Uma edição posterior pode ocultar edições anteriores. A visibilidade do grupo
-- também é a atual. Não há histórico suficiente para reconstruir todas as ações.
WITH horarios_originais AS (
  SELECT json_extract(value, '$.match_id') AS match_id,
         json_extract(value, '$.start_time_original') AS start_time_original
  FROM json_each('[]')
), candidatos AS (
  SELECT m.id, m.start_time, m.postponed, m.locked_at,
         COALESCE(h.start_time_original, m.start_time) AS horario_referencia,
         CASE WHEN h.match_id IS NULL THEN 'ultimo_horario_conhecido'
              ELSE 'historico_fornecido' END AS origem_horario
  FROM matches m
  LEFT JOIN horarios_originais h ON h.match_id = m.id
  WHERE m.postponed = 1
     OR julianday(m.start_time) > julianday(h.start_time_original)
)
SELECT p.id AS prediction_id, p.group_id, p.match_id, p.created_at, p.updated_at,
       c.start_time, c.horario_referencia, c.origem_horario, c.postponed, c.locked_at
FROM predictions p
JOIN groups g ON g.id = p.group_id
JOIN candidatos c ON c.id = p.match_id
WHERE g.predictions_visibility = 'hidden'
  AND julianday(p.updated_at) > julianday(c.horario_referencia)
ORDER BY p.updated_at DESC, p.id;
