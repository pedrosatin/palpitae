-- Nome popular dos clubes do Brasileirão Série A vindos da football-data.org.
-- O upsert de times só atualiza logo_url no conflito, então as linhas já gravadas
-- com o nome oficial ("CR Flamengo", "CA Mineiro") precisam desta correção.
-- Casa por external_id + provider: times da ESPN (Copa do Brasil, Série B) não mudam.
-- Sigla (short_name) e slug ficam como estão. Mesmo mapa de src/matches/clubNames.ts.
UPDATE teams SET name = 'Fluminense' WHERE provider = 'football-data' AND external_id = '1765';
UPDATE teams SET name = 'Atlético-MG' WHERE provider = 'football-data' AND external_id = '1766';
UPDATE teams SET name = 'Grêmio' WHERE provider = 'football-data' AND external_id = '1767';
UPDATE teams SET name = 'Athletico-PR' WHERE provider = 'football-data' AND external_id = '1768';
UPDATE teams SET name = 'Palmeiras' WHERE provider = 'football-data' AND external_id = '1769';
UPDATE teams SET name = 'Botafogo' WHERE provider = 'football-data' AND external_id = '1770';
UPDATE teams SET name = 'Cruzeiro' WHERE provider = 'football-data' AND external_id = '1771';
UPDATE teams SET name = 'Chapecoense' WHERE provider = 'football-data' AND external_id = '1772';
UPDATE teams SET name = 'São Paulo' WHERE provider = 'football-data' AND external_id = '1776';
UPDATE teams SET name = 'Bahia' WHERE provider = 'football-data' AND external_id = '1777';
UPDATE teams SET name = 'Corinthians' WHERE provider = 'football-data' AND external_id = '1779';
UPDATE teams SET name = 'Vasco da Gama' WHERE provider = 'football-data' AND external_id = '1780';
UPDATE teams SET name = 'Vitória' WHERE provider = 'football-data' AND external_id = '1782';
UPDATE teams SET name = 'Flamengo' WHERE provider = 'football-data' AND external_id = '1783';
UPDATE teams SET name = 'Coritiba' WHERE provider = 'football-data' AND external_id = '4241';
UPDATE teams SET name = 'Red Bull Bragantino' WHERE provider = 'football-data' AND external_id = '4286';
UPDATE teams SET name = 'Remo' WHERE provider = 'football-data' AND external_id = '4287';
UPDATE teams SET name = 'Mirassol' WHERE provider = 'football-data' AND external_id = '4364';
UPDATE teams SET name = 'Internacional' WHERE provider = 'football-data' AND external_id = '6684';
UPDATE teams SET name = 'Santos' WHERE provider = 'football-data' AND external_id = '6685';
