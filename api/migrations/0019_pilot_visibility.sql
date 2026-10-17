-- Controle de visibilidade para testes em grupo fechado antes da abertura geral.
-- Competições existentes e futuras nascem com 'public' por padrão.
ALTER TABLE competitions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'pilot'));
