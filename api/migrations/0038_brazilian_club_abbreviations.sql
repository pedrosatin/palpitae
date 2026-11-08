-- Sigla dos clubes do Brasileirão Série A vindos da football-data.org.
-- A tla da API repete "COR" (Coritiba e Corinthians) e traz "PAU", "FBP", "SCI" e "CRE".
-- Passa a valer a abbreviation da ESPN, sem repetição entre os 20 clubes.
-- O upsert de times só atualiza logo_url no conflito, então as linhas já gravadas precisam desta correção.
-- O filtro por provider e external_id deixa de fora os times da ESPN e os europeus da football-data.
-- Nome e slug ficam como estão. Mesmo mapa de src/matches/clubNames.ts.
-- Reverter exige uma migration inversa com as siglas anteriores.
UPDATE teams SET short_name = 'FLU' WHERE provider = 'football-data' AND external_id = '1765';
UPDATE teams SET short_name = 'CAM' WHERE provider = 'football-data' AND external_id = '1766';
UPDATE teams SET short_name = 'GRE' WHERE provider = 'football-data' AND external_id = '1767';
UPDATE teams SET short_name = 'CAP' WHERE provider = 'football-data' AND external_id = '1768';
UPDATE teams SET short_name = 'PAL' WHERE provider = 'football-data' AND external_id = '1769';
UPDATE teams SET short_name = 'BOT' WHERE provider = 'football-data' AND external_id = '1770';
UPDATE teams SET short_name = 'CRU' WHERE provider = 'football-data' AND external_id = '1771';
UPDATE teams SET short_name = 'CHA' WHERE provider = 'football-data' AND external_id = '1772';
UPDATE teams SET short_name = 'SAO' WHERE provider = 'football-data' AND external_id = '1776';
UPDATE teams SET short_name = 'BAH' WHERE provider = 'football-data' AND external_id = '1777';
UPDATE teams SET short_name = 'COR' WHERE provider = 'football-data' AND external_id = '1779';
UPDATE teams SET short_name = 'VAS' WHERE provider = 'football-data' AND external_id = '1780';
UPDATE teams SET short_name = 'VIT' WHERE provider = 'football-data' AND external_id = '1782';
UPDATE teams SET short_name = 'FLA' WHERE provider = 'football-data' AND external_id = '1783';
UPDATE teams SET short_name = 'CFC' WHERE provider = 'football-data' AND external_id = '4241';
UPDATE teams SET short_name = 'BRA' WHERE provider = 'football-data' AND external_id = '4286';
UPDATE teams SET short_name = 'REMO' WHERE provider = 'football-data' AND external_id = '4287';
UPDATE teams SET short_name = 'MIR' WHERE provider = 'football-data' AND external_id = '4364';
UPDATE teams SET short_name = 'INT' WHERE provider = 'football-data' AND external_id = '6684';
UPDATE teams SET short_name = 'SAN' WHERE provider = 'football-data' AND external_id = '6685';
