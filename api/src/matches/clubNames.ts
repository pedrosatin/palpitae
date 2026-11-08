/**
 * Nome popular dos clubes brasileiros que vêm da football-data.org (Brasileirão
 * Série A, código BSA). A API manda o nome oficial ("CR Flamengo", "CA Mineiro"),
 * que a Tabela do mobile corta e que destoa da Copa do Brasil (ESPN).
 *
 * A chave é o `team.id` da football-data (`teams.external_id`), estável entre
 * temporadas, enquanto a grafia do nome oficial pode mudar. Os nomes seguem o
 * `shortDisplayName` da ESPN, que cabe na Tabela e continua contido no
 * `displayName`. Assim o fallback de resultados (espnFallback.ts) casa
 * Atlético-MG, Athletico-PR e Bragantino.
 *
 * A sigla (`short_name`) e o slug continuam vindo da API. A migration
 * 0035_brazilian_club_names.sql aplica o mesmo mapa às linhas já gravadas.
 *
 * Clube novo, como um promovido, ganha uma entrada aqui. Se a linha dele já
 * existe no banco, ele também precisa de uma migration. O upsert do sync só
 * atualiza `logo_url` em time existente e não reescreve o nome.
 */
export const FOOTBALL_DATA_CLUB_NAMES: Readonly<Record<string, string>> = {
  '1765': 'Fluminense', // Fluminense FC
  '1766': 'Atlético-MG', // CA Mineiro
  '1767': 'Grêmio', // Grêmio FBPA
  '1768': 'Athletico-PR', // CA Paranaense
  '1769': 'Palmeiras', // SE Palmeiras
  '1770': 'Botafogo', // Botafogo FR
  '1771': 'Cruzeiro', // Cruzeiro EC
  '1772': 'Chapecoense', // Chapecoense AF
  '1776': 'São Paulo', // São Paulo FC
  '1777': 'Bahia', // EC Bahia
  '1779': 'Corinthians', // SC Corinthians Paulista
  '1780': 'Vasco', // CR Vasco da Gama
  '1782': 'Vitória', // EC Vitória
  '1783': 'Flamengo', // CR Flamengo
  '4241': 'Coritiba', // Coritiba FBC
  '4286': 'Bragantino', // RB Bragantino
  '4287': 'Remo', // Clube do Remo
  '4364': 'Mirassol', // Mirassol FC
  '6684': 'Internacional', // SC Internacional
  '6685': 'Santos', // Santos FC
}
