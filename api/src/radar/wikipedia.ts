/**
 * Wikimedia Pageviews API — sinal de interesse do público brasileiro por
 * competição (pageviews diários do artigo na pt.wikipedia).
 *
 * Grátis, oficial, sem chave e com série diária desde 2015. Exige um
 * User-Agent identificável (a Wikimedia bloqueia agentes anônimos), e os dados
 * ficam prontos com ~1-2 dias de atraso — por isso o cron coleta uma janela
 * recente inteira em vez do dia de ontem, e o upsert por (radar_id, day)
 * preenche os dias que ainda estavam vazios.
 */

const PAGEVIEWS_BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article'

const USER_AGENT = 'palpitae-radar/1.0 (https://palpitae.com.br)'

type PageviewsResponse = {
  items?: { timestamp?: string; views?: number }[]
}

/** "YYYY-MM-DD" → "YYYYMMDD" (formato que a API espera nos limites). */
function compact(day: string): string {
  return day.replaceAll('-', '')
}

/**
 * Pageviews diários de um artigo no intervalo [from, to] (YYYY-MM-DD, UTC).
 * Devolve um mapa dia → views, com apenas os dias que a Wikimedia já
 * consolidou. Artigo inexistente responde 404 — devolve mapa vazio em vez de
 * estourar, porque um título errado na curadoria não pode derrubar o cron
 * inteiro (a dashboard mostra a competição sem sinal e o erro fica no log).
 */
export async function fetchPageviews(
  article: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  // `encodeURIComponent` não escapa `/`, que na URL viraria um segmento novo e
  // quebraria a rota (ex.: "AC/DC"). Espaço vira `_` como manda a convenção.
  const encoded = encodeURIComponent(article.replaceAll(' ', '_')).replaceAll('%2F', '%252F')
  const url = `${PAGEVIEWS_BASE}/pt.wikipedia/all-access/user/${encoded}/daily/${compact(from)}/${compact(to)}`

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (res.status === 404) return new Map()
  if (!res.ok) {
    throw new Error(`Pageviews respondeu ${res.status} para "${article}"`)
  }

  const payload = (await res.json()) as PageviewsResponse
  const byDay = new Map<string, number>()
  for (const item of payload.items ?? []) {
    // timestamp vem como "YYYYMMDD00" (hora sempre 00 no grão diário).
    const ts = item.timestamp
    if (!ts || ts.length < 8) continue
    byDay.set(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`, item.views ?? 0)
  }
  return byDay
}
