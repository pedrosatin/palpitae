/**
 * Cliente da API-Football (api-sports.io) — usada SÓ pelo radar admin, nunca
 * pelo produto. Os jogos que alimentam palpites continuam vindo do
 * football-data.org (ADR-007/ADR-010); aqui o que interessa é a cobertura:
 * ~1.200 ligas contra as 12 do plano grátis do football-data, o que inclui
 * Libertadores, Sul-Americana, Copa do Brasil e estaduais.
 *
 * Quota: 100 requisições/dia no plano grátis, zeradas às 00:00 UTC. O radar
 * gasta 2 por dia (catálogo + jogos do dia), então a folga é enorme — mas as
 * duas funções aqui são deliberadamente "1 chamada cada": buscar por liga
 * estouraria a quota na primeira execução.
 */

const API_BASE = 'https://v3.football.api-sports.io'

export type ProviderLeague = {
  externalId: string
  name: string
  country: string
  type: string | null
  logoUrl: string | null
  season: string
  startsOn: string | null
  endsOn: string | null
}

type LeaguesResponse = {
  errors?: unknown
  response?: {
    league?: { id?: number; name?: string; type?: string; logo?: string }
    country?: { name?: string }
    seasons?: { year?: number; start?: string; end?: string; current?: boolean }[]
  }[]
}

type FixturesResponse = {
  errors?: unknown
  response?: { league?: { id?: number } }[]
}

async function callApi<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-apisports-key': apiKey },
  })
  if (!res.ok) {
    throw new Error(`API-Football respondeu ${res.status} em ${path}`)
  }
  const payload = (await res.json()) as T & { errors?: unknown }

  // A API-Football responde 200 com `errors` preenchido quando a chave é
  // inválida ou a quota estourou — tratar como sucesso gravaria um radar vazio
  // por cima do snapshot bom do dia anterior.
  const errors = payload.errors
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : !!errors && typeof errors === 'object' && Object.keys(errors).length > 0
  if (hasErrors) {
    throw new Error(`API-Football retornou erro em ${path}: ${JSON.stringify(errors)}`)
  }
  return payload
}

/**
 * Catálogo de ligas com temporada corrente — 1 chamada devolve o mundo inteiro.
 * Só as temporadas marcadas como `current` entram: uma liga pode ter 15 anos de
 * histórico no catálogo e nos interessa apenas a edição em andamento.
 */
export async function fetchCurrentLeagues(apiKey: string): Promise<ProviderLeague[]> {
  const payload = await callApi<LeaguesResponse>('/leagues?current=true', apiKey)

  const leagues: ProviderLeague[] = []
  for (const item of payload.response ?? []) {
    const id = item.league?.id
    const name = item.league?.name
    const season = item.seasons?.find((s) => s.current)
    if (id === undefined || !name || !season?.year) continue

    leagues.push({
      externalId: String(id),
      name,
      country: item.country?.name ?? 'World',
      type: item.league?.type ?? null,
      logoUrl: item.league?.logo ?? null,
      season: String(season.year),
      startsOn: season.start ?? null,
      endsOn: season.end ?? null,
    })
  }
  return leagues
}

/**
 * Quantos jogos cada liga tem numa data — 1 chamada devolve os jogos do dia no
 * mundo inteiro, agregados aqui por liga. É o sinal de "está rolando agora" sem
 * pagar 1 chamada por competição.
 */
export async function fetchMatchCountByLeague(
  apiKey: string,
  day: string,
): Promise<Map<string, number>> {
  const payload = await callApi<FixturesResponse>(`/fixtures?date=${day}`, apiKey)

  const counts = new Map<string, number>()
  for (const fixture of payload.response ?? []) {
    const id = fixture.league?.id
    if (id === undefined) continue
    const key = String(id)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
