
import { normalizeName } from '../normalizeName'

/** Competição observada pelo radar: como reconhecê-la e como medi-la. */
export type RadarEntry = {
  country: string
  name: string
  aliases?: string[]
  article: string
  palpitaeSlug?: string
}

/**
 * Competições mapeadas. Não é exaustiva de propósito — o radar guarda TODAS as
 * ligas dos países relevantes, e a dashboard mostra as não mapeadas numa seção
 * própria pra virarem candidatas a entrar aqui.
 */
export const RADAR_ENTRIES: RadarEntry[] = [
  {
    country: 'Brazil',
    name: 'Serie A',
    article: 'Campeonato Brasileiro de Futebol',
    palpitaeSlug: 'campeonato-brasileiro-serie-a',
  },
  {
    country: 'Brazil',
    name: 'Serie B',
    article: 'Campeonato Brasileiro de Futebol - Série B',
    palpitaeSlug: 'brasileirao-serie-b',
  },
  { country: 'Brazil', name: 'Serie C', article: 'Campeonato Brasileiro de Futebol - Série C' },
  {
    country: 'Brazil',
    name: 'Copa Do Brasil',
    article: 'Copa do Brasil de Futebol',
    palpitaeSlug: 'copa-do-brasil',
  },
  { country: 'Brazil', name: 'Copa Do Nordeste', article: 'Copa do Nordeste de Futebol' },
  { country: 'Brazil', name: 'Supercopa do Brasil', article: 'Supercopa Rei' },
  {
    country: 'Brazil',
    name: 'Brasileiro Women',
    article: 'Campeonato Brasileiro de Futebol Feminino',
  },

  { country: 'Brazil', name: 'Paulista - A1', article: 'Campeonato Paulista de Futebol Masculino' },
  { country: 'Brazil', name: 'Carioca - 1', article: 'Campeonato Carioca de Futebol Masculino' },
  { country: 'Brazil', name: 'Mineiro - 1', article: 'Campeonato Mineiro de Futebol Masculino' },
  { country: 'Brazil', name: 'Gaucho - 1', article: 'Campeonato Gaúcho de Futebol Masculino' },
  { country: 'Brazil', name: 'Baiano - 1', article: 'Campeonato Baiano de Futebol Masculino' },
  {
    country: 'Brazil',
    name: 'Pernambucano - 1',
    article: 'Campeonato Pernambucano de Futebol Masculino',
  },
  {
    country: 'Brazil',
    name: 'Paranaense - 1',
    article: 'Campeonato Paranaense de Futebol Masculino',
  },

  {
    country: 'World',
    name: 'CONMEBOL Libertadores',
    article: 'Copa Libertadores da América',
    palpitaeSlug: 'conmebol-libertadores',
  },
  {
    country: 'World',
    name: 'CONMEBOL Sudamericana',
    article: 'Copa Sul-Americana',
    palpitaeSlug: 'conmebol-sudamericana',
  },
  { country: 'World', name: 'CONMEBOL Recopa', article: 'Recopa Sul-Americana' },
  { country: 'World', name: 'Copa America', article: 'Copa América' },

  {
    country: 'World',
    name: 'World Cup',
    article: 'Copa do Mundo FIFA',
    palpitaeSlug: 'copa-do-mundo-fifa',
  },
  {
    country: 'World',
    name: 'World Cup - Qualification South America',
    aliases: ['World Cup - Qualification CONMEBOL'],
    article: 'Eliminatórias da Copa do Mundo FIFA de 2026',
  },
  { country: 'World', name: 'Euro Championship', article: 'Campeonato Europeu de Futebol' },
  { country: 'World', name: 'UEFA Nations League', article: 'Liga das Nações da UEFA' },
  { country: 'World', name: 'FIFA Club World Cup', article: 'Copa do Mundo de Clubes da FIFA' },

  {
    country: 'World',
    name: 'UEFA Champions League',
    article: 'Liga dos Campeões da UEFA',
    palpitaeSlug: 'uefa-champions-league',
  },
  { country: 'World', name: 'UEFA Europa League', article: 'Liga Europa da UEFA' },
  {
    country: 'World',
    name: 'UEFA Europa Conference League',
    aliases: ['UEFA Conference League'],
    article: 'Liga Conferência da UEFA',
  },

  {
    country: 'England',
    name: 'Premier League',
    article: 'Premier League',
    palpitaeSlug: 'premier-league',
  },
  {
    country: 'England',
    name: 'Championship',
    article: 'EFL Championship',
    palpitaeSlug: 'championship',
  },
  {
    country: 'Spain',
    name: 'La Liga',
    article: 'La Liga',
    palpitaeSlug: 'la-liga',
  },
  {
    country: 'Italy',
    name: 'Serie A',
    article: 'Campeonato Italiano de Futebol – Série A',
    palpitaeSlug: 'serie-a',
  },
  {
    country: 'Germany',
    name: 'Bundesliga',
    article: 'Bundesliga',
    palpitaeSlug: 'bundesliga',
  },
  {
    country: 'France',
    name: 'Ligue 1',
    article: 'Ligue 1',
    palpitaeSlug: 'ligue-1',
  },
  {
    country: 'Portugal',
    name: 'Primeira Liga',
    article: 'Primeira Liga',
    palpitaeSlug: 'primeira-liga',
  },
  {
    country: 'Netherlands',
    name: 'Eredivisie',
    article: 'Eredivisie',
    palpitaeSlug: 'eredivisie',
  },
  {
    country: 'Argentina',
    name: 'Liga Profesional Argentina',
    aliases: ['Primera División'],
    article: 'Campeonato Argentino de Futebol',
  },
  { country: 'USA', name: 'Major League Soccer', article: 'Major League Soccer' },
  { country: 'Mexico', name: 'Liga MX', article: 'Liga MX' },
  { country: 'Saudi-Arabia', name: 'Pro League', article: 'Campeonato Saudita de Futebol' },
]

/**
 * Países cujas ligas são guardadas mesmo sem artigo mapeado — o recorte de
 * "poderia interessar a um brasileiro". Sem esse filtro guardaríamos as ~1.200
 * ligas do catálogo do provider, e 99% delas é ruído (terceira divisão da
 * Estônia não vira grupo no Palpitae).
 *
 * Ligas de países fora desta lista só entram se estiverem em RADAR_ENTRIES.
 */
export const RADAR_COUNTRIES = new Set([
  'World',
  'Brazil',
  'Argentina',
  'Uruguay',
  'Chile',
  'Colombia',
  'Paraguay',
  'Peru',
  'Bolivia',
  'Ecuador',
  'Venezuela',
  'England',
  'Spain',
  'Italy',
  'Germany',
  'France',
  'Portugal',
  'Netherlands',
  'USA',
  'Mexico',
  'Saudi-Arabia',
])

/**
 * Chave de casamento: minúsculas, sem acento e sem pontuação. O provider varia
 * casing e hífens entre temporadas ("Copa Do Brasil" / "Copa do Brasil"), e um
 * mismatch aqui só custaria o sinal de interesse daquela competição.
 */
function matchKey(country: string, name: string): string {
  return `${normalizeName(country)}|${normalizeName(name)}`
}

const BY_KEY = new Map<string, RadarEntry>()
for (const entry of RADAR_ENTRIES) {
  BY_KEY.set(matchKey(entry.country, entry.name), entry)
  for (const alias of entry.aliases ?? []) {
    BY_KEY.set(matchKey(entry.country, alias), entry)
  }
}

/** Entrada curada para uma liga do provider, ou `undefined` se não mapeada. */
export function findEntry(country: string, name: string): RadarEntry | undefined {
  return BY_KEY.get(matchKey(country, name))
}
