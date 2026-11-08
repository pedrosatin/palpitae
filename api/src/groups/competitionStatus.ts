/**
 * Status da competição do grupo, como a lista e o detalhe devolvem em
 * `competition_status`.
 *
 * `competitions.status` hoje nasce 'upcoming' e nunca é atualizado, então
 * derivamos o fim a partir dos jogos reais: acabou quando a competição tem
 * partidas e nenhuma está pendente. Ainda respeitamos a coluna caso ela venha
 * a ser mantida no futuro.
 *
 * Fragmento correlacionado aos aliases do grupo (padrão `g`) e da competição
 * (padrão `c`, vindo de `LEFT JOIN competitions c`). Não usa binds.
 */
export function competitionStatusSql(groupAlias = 'g', competitionAlias = 'c'): string {
  return `CASE
            WHEN ${competitionAlias}.status = 'finished' THEN 'finished'
            WHEN EXISTS (
              SELECT 1 FROM matches m WHERE m.competition_id = ${groupAlias}.competition_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM matches m
              WHERE m.competition_id = ${groupAlias}.competition_id AND m.status != 'finished'
            )
            THEN 'finished'
            ELSE ${competitionAlias}.status
          END`
}
