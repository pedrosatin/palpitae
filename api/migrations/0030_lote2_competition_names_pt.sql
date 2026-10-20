-- Nomes de exibição PT do lote 2 (ops/04).
-- Slugs permanecem estáveis; só o campo name muda onde ainda estava o rótulo cru da API.
UPDATE competitions SET name = 'La Liga' WHERE slug = 'la-liga-2026';
UPDATE competitions SET name = 'Serie A Italiana' WHERE slug = 'serie-a-2026';
UPDATE competitions SET name = 'Bundesliga' WHERE slug = 'bundesliga-2026';
UPDATE competitions SET name = 'Primeira Liga' WHERE slug = 'primeira-liga-2026';
UPDATE competitions SET name = 'Brasileirão Série B' WHERE slug = 'brasileirao-serie-b-2026';
