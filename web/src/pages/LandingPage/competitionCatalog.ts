/**
 * Campeonatos em que a landing diz que dá para criar bolão.
 *
 * Lista só competições com `visibility = 'public'` no D1, as mesmas que o modal
 * "Criar grupo" recebe de `GET /competitions` para um usuário comum. Competição
 * em piloto fica de fora até o promote administrativo (ver
 * `docs/operations/promocao-lote2.md`). Para anunciar uma nova, acrescente uma
 * linha aqui. A seção, o FAQ visível e o JSON-LD do `index.html` saem desta lista.
 *
 * Os nomes não levam temporada, para o texto não envelhecer a cada ano.
 */

export type CatalogRegion = 'brasil' | 'europa'

export type CatalogCompetition = {
  /** Slug da temporada vigente em `competitions.slug`, usado só para conferência em teste. */
  slug: string
  name: string
  region: CatalogRegion
}

export const COMPETITION_CATALOG: readonly CatalogCompetition[] = [
  { slug: 'campeonato-brasileiro-serie-a-2026', name: 'Brasileirão Série A', region: 'brasil' },
  { slug: 'copa-do-brasil-2026', name: 'Copa do Brasil', region: 'brasil' },
  { slug: 'uefa-champions-league-2026', name: 'Liga dos Campeões', region: 'europa' },
  { slug: 'premier-league-2026', name: 'Premier League', region: 'europa' },
]

const REGIONS: readonly { region: CatalogRegion; label: string; inline: string }[] = [
  { region: 'brasil', label: 'No Brasil', inline: 'no Brasil' },
  { region: 'europa', label: 'Europa', inline: 'na Europa' },
]

export type CatalogGroup = { region: CatalogRegion; label: string; inline: string; names: string[] }

/** Agrupa por região, "No Brasil" antes de "Europa", sem região vazia. */
export function groupCatalog(
  catalog: readonly CatalogCompetition[] = COMPETITION_CATALOG,
): CatalogGroup[] {
  return REGIONS.map((r) => ({
    ...r,
    names: catalog.filter((c) => c.region === r.region).map((c) => c.name),
  })).filter((group) => group.names.length > 0)
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

/** Texto curto para o selo do topo. */
export function catalogEyebrow(
  catalog: readonly CatalogCompetition[] = COMPETITION_CATALOG,
): string {
  return `Bolão grátis em ${catalog.length} ${catalog.length === 1 ? 'campeonato' : 'campeonatos'}`
}

/** Resposta do FAQ "Quais campeonatos tem no Palpitae?". Também vai no JSON-LD. */
export function catalogFaqAnswer(
  catalog: readonly CatalogCompetition[] = COMPETITION_CATALOG,
): string {
  const parts = groupCatalog(catalog).map((g) => `${g.inline} com ${joinNames(g.names)}`)
  return `Hoje dá para criar bolão ${joinNames(parts)}. Cada grupo acompanha um campeonato, e a lista cresce conforme novas competições entram.`
}
