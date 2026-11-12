/**
 * Configuração de cada competição que o sync da football-data pode criar.
 *
 * A chave é o código da competição na football-data (`competition.code` na
 * resposta). `id` é o id numérico dela, gravado em `competitions.external_id`.
 * O sync só consulta este mapa quando a competição da temporada ainda não existe
 * no banco: a competição nova nasce em piloto, com nome, slug, tipo e fases de
 * pênaltis daqui, e nunca com os defaults da tabela (`cup`, `public`, `[]`).
 * Código fora do mapa não cria competição (evento `competition_unconfigured`).
 *
 * Os valores repetem os de produção em 12/11/2026, para que recriar a competição
 * numa temporada nova ou num banco restaurado dê o mesmo resultado que o seed.
 * `penaltyPhases` lista as fases de mata-mata em jogo único que vão a pênaltis;
 * liga de pontos corridos fica com lista vazia.
 */
export type FootballDataCompetitionConfig = {
  id: number
  name: string
  /** Slug sem a temporada. O slug gravado é `${slugPrefix}-${season}`. */
  slugPrefix: string
  type: 'league' | 'cup'
  penaltyPhases: string[]
}

export const FOOTBALL_DATA_COMPETITIONS: Record<string, FootballDataCompetitionConfig> = {
  WC: {
    id: 2000,
    name: 'Copa do Mundo FIFA',
    slugPrefix: 'fifa-world-cup',
    type: 'cup',
    penaltyPhases: ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'],
  },
  CL: {
    id: 2001,
    name: 'Liga dos Campeões',
    slugPrefix: 'uefa-champions-league',
    type: 'cup',
    // Só a final é jogo único; nas outras fases de mata-mata o confronto tem ida e volta.
    penaltyPhases: ['FINAL'],
  },
  BL1: {
    id: 2002,
    name: 'Bundesliga',
    slugPrefix: 'bundesliga',
    type: 'league',
    penaltyPhases: [],
  },
  DED: {
    id: 2003,
    name: 'Eredivisie',
    slugPrefix: 'eredivisie',
    type: 'league',
    penaltyPhases: [],
  },
  BSA: {
    id: 2013,
    name: 'Brasileirão Série A',
    slugPrefix: 'campeonato-brasileiro-serie-a',
    type: 'league',
    penaltyPhases: [],
  },
  PD: { id: 2014, name: 'La Liga', slugPrefix: 'la-liga', type: 'league', penaltyPhases: [] },
  FL1: { id: 2015, name: 'Ligue 1', slugPrefix: 'ligue-1', type: 'league', penaltyPhases: [] },
  ELC: {
    id: 2016,
    name: 'Championship',
    slugPrefix: 'championship',
    type: 'league',
    penaltyPhases: [],
  },
  PPL: {
    id: 2017,
    name: 'Primeira Liga',
    slugPrefix: 'primeira-liga',
    type: 'league',
    penaltyPhases: [],
  },
  SA: {
    id: 2019,
    name: 'Serie A Italiana',
    slugPrefix: 'serie-a',
    type: 'league',
    penaltyPhases: [],
  },
  PL: {
    id: 2021,
    name: 'Premier League',
    slugPrefix: 'premier-league',
    type: 'league',
    penaltyPhases: [],
  },
}

export function footballDataCompetitionConfig(
  code: string | undefined,
): FootballDataCompetitionConfig | undefined {
  return code !== undefined && Object.hasOwn(FOOTBALL_DATA_COMPETITIONS, code)
    ? FOOTBALL_DATA_COMPETITIONS[code]
    : undefined
}
