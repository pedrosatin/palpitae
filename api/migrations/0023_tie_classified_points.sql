-- Jogo do confronto no mata-mata: 1 para ida, 2 para volta, NULL para jogo único, fase de grupos ou liga.
ALTER TABLE matches ADD COLUMN leg INTEGER CHECK (leg IN (1, 2));

-- Pontuação por acertar o classificado do confronto, creditada apenas no jogo decisivo.
ALTER TABLE predictions ADD COLUMN classified_points INTEGER NOT NULL DEFAULT 0;

-- Pontos que o grupo dá pelo acerto do classificado. 0 desativa.
ALTER TABLE groups ADD COLUMN points_classified INTEGER NOT NULL DEFAULT 0 CHECK (points_classified BETWEEN 0 AND 10);
