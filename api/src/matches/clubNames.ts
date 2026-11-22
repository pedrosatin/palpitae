/**
 * Nome popular e sigla dos clubes brasileiros que vêm da football-data.org (Brasileirão
 * Série A, código BSA). A API manda o nome oficial ("CR Flamengo", "CA Mineiro"),
 * que a Tabela do mobile corta e que destoa da Copa do Brasil (ESPN).
 *
 * A chave é o `team.id` da football-data (`teams.external_id`), estável entre
 * temporadas, enquanto a grafia do nome oficial pode mudar. Os nomes seguem o
 * `shortDisplayName` da ESPN, que cabe na Tabela e continua contido no
 * `displayName`. Assim o fallback de resultados (espnFallback.ts) casa
 * Atlético-MG, Athletico-PR e Bragantino.
 *
 * A sigla (`short_name`) segue o `abbreviation` da ESPN. A `tla` da football-data
 * repete "COR" para Coritiba e Corinthians e traz "PAU", "FBP", "SCI" e "CRE".
 * Nenhuma sigla se repete entre os 20 clubes. O slug continua vindo da API.
 * As migrations 0035_brazilian_club_names.sql (nome) e
 * 0038_brazilian_club_abbreviations.sql (sigla) aplicam o mesmo mapa às linhas já gravadas.
 *
 * Clube novo, como um promovido, ganha uma entrada aqui. Se a linha dele já
 * existe no banco, ele também precisa de uma migration. O upsert do sync só
 * atualiza `logo_url` em time existente e não reescreve nome nem sigla.
 */
export const FOOTBALL_DATA_CLUBS: Readonly<Record<string, { name: string; shortName: string }>> = {
  '1765': { name: 'Fluminense', shortName: 'FLU' },
  '1766': { name: 'Atlético-MG', shortName: 'CAM' },
  '1767': { name: 'Grêmio', shortName: 'GRE' },
  '1768': { name: 'Athletico-PR', shortName: 'CAP' },
  '1769': { name: 'Palmeiras', shortName: 'PAL' },
  '1770': { name: 'Botafogo', shortName: 'BOT' },
  '1771': { name: 'Cruzeiro', shortName: 'CRU' },
  '1772': { name: 'Chapecoense', shortName: 'CHA' },
  '1776': { name: 'São Paulo', shortName: 'SAO' },
  '1777': { name: 'Bahia', shortName: 'BAH' },
  '1779': { name: 'Corinthians', shortName: 'COR' },
  '1780': { name: 'Vasco', shortName: 'VAS' },
  '1782': { name: 'Vitória', shortName: 'VIT' },
  '1783': { name: 'Flamengo', shortName: 'FLA' },
  '4241': { name: 'Coritiba', shortName: 'CFC' },
  '4286': { name: 'Bragantino', shortName: 'BRA' },
  '4287': { name: 'Remo', shortName: 'REMO' },
  '4364': { name: 'Mirassol', shortName: 'MIR' },
  '6684': { name: 'Internacional', shortName: 'INT' },
  '6685': { name: 'Santos', shortName: 'SAN' },
}
