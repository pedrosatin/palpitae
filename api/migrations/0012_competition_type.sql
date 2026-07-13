-- Aba "Tabela" (classificação do campeonato) só faz sentido em pontos corridos —
-- na Copa ela servia apenas para a fase de grupos e foi removida da UI.
-- Gate data-driven por competição, mesmo padrão do penalty_phases (0010):
-- default 'cup' = fail-closed (sem tabela); ligas são marcadas explicitamente.
ALTER TABLE competitions ADD COLUMN type TEXT NOT NULL DEFAULT 'cup' CHECK (type IN ('league', 'cup'));

-- Brasileirão Série A 2026 é liga (slug confirmado no prod DB, seed de 2026-07-12).
UPDATE competitions SET type = 'league' WHERE slug = 'campeonato-brasileiro-serie-a-2026';
