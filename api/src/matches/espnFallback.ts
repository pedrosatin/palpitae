import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'

/**
 * Fallback de RESULTADOS via ESPN (ADR-016). Quando o sync da football-data.org
 * falha (429/5xx/outage), o jogo na janela ativa ficava sem placar até o provedor
 * primário voltar. Aqui a ESPN não-oficial preenche o placar de jogos que JÁ
 * existem no D1 — nunca insere jogos, times ou competições.
 *
 * Endpoint: GET site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard
 * — 200 sem auth, sem quota conhecida. Detalhe validado ao vivo (05/10/2026):
 * o parâmetro de data é `dates=YYYYMMDD` (plural). O singular `date=` é
 * silenciosamente IGNORADO e devolve a rodada corrente — todos os eventos em
 * estado 'pre', ou seja, um fallback que nunca atualiza nada.
 */

/**
 * Código football-data.org → slug ESPN, cobrindo os códigos plausíveis do free
 * tier (TIER_ONE na nomenclatura deles). Conferido ao vivo em
 * api.football-data.org/v4/competitions:
 *   - `EL` é UEFA Europa League (TIER_TWO, mas mapeado por segurança);
 *   - `ECL` NÃO existe — Conference League é `UCL` (TIER_FOUR, fora do free
 *     tier e sem uso no produto hoje);
 *   - `EC` (Eurocopa) é TIER_ONE e entra por ser o torneio de seleções mais
 *     plausível depois da Copa (ADR-011).
 * Código sem mapeamento → fallback não se aplica (log info, não é erro).
 */
export const FOOTBALL_DATA_TO_ESPN: Record<string, string> = {
  BSA: 'bra.1',
  WC: 'fifa.world',
  EC: 'uefa.euro',
  PL: 'eng.1',
  PD: 'esp.1',
  SA: 'ita.1',
  BL1: 'ger.1',
  FL1: 'fra.1',
  DED: 'ned.1',
  PPL: 'por.1',
  CL: 'uefa.champions',
  EL: 'uefa.europa',
}

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer'

/**
 * Tolerância entre o `start_time` interno e o `date` do evento ESPN. Os dois
 * provedores divergem em remarcamentos de última hora; 150 min cobre isso sem
 * abrir a porta para casar jogos de rodadas diferentes no mesmo dia.
 */
const KICKOFF_TOLERANCE_MS = 150 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

type EspnCompetitor = {
  homeAway?: string
  team?: { displayName?: string }
  score?: string
}

type EspnEvent = {
  date?: string
  status?: { type?: { state?: string } }
  competitions?: { competitors?: EspnCompetitor[] }[]
}

type WindowMatch = {
  id: string
  start_time: string
  home_name: string
  away_name: string
  comp_code: string | null
}

export type EspnFallbackOptions = {
  /**
   * Instante de referência da janela ativa. O poller passa o `now` que ele
   * mesmo computou, garantindo janelas idênticas entre a query dele e a daqui.
   */
  now?: number
}

/**
 * Normalização de nome — mesmo padrão do `matchKey` de radar/articles.ts:
 * NFD, sem diacritics, lowercase, sem pontuação. 'São Paulo' e 'Sao Paulo'
 * viram a mesma chave.
 */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Casamento por conter/contido nos DOIS sentidos: football-data usa nomes
 * completos ('CR Flamengo', 'SC Corinthians Paulista') e a ESPN os encurta
 * ('Flamengo', 'Corinthians'). Exige relação em ambos os lados do confronto
 * (mandante-com-mandante e visitante-com-visitante).
 */
function namesRelated(a: string, b: string): boolean {
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

async function fetchEspnScoreboard(slug: string, yyyymmdd: string): Promise<EspnEvent[]> {
  const res = await fetch(`${ESPN_API_BASE}/${slug}/scoreboard?dates=${yyyymmdd}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ESPN scoreboard respondeu ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { events?: EspnEvent[] }
  return data.events ?? []
}

function espnCompetitors(ev: EspnEvent): { home: EspnCompetitor | undefined; away: EspnCompetitor | undefined } {
  const competitors = ev.competitions?.[0]?.competitors ?? []
  return {
    home: competitors.find((c) => c.homeAway === 'home'),
    away: competitors.find((c) => c.homeAway === 'away'),
  }
}

/**
 * Um evento ESPN casa com um jogo interno quando o kickoff está dentro da
 * tolerância E os nomes normalizados de ambos os times se contêm. Falta de
 * qualquer lado (data inválida, competitor ausente) → não casa (fail-closed).
 */
function matchesEvent(m: WindowMatch, ev: EspnEvent): boolean {
  if (!ev.date) return false
  const kickoff = Date.parse(ev.date)
  const start = Date.parse(m.start_time)
  if (!Number.isFinite(kickoff) || !Number.isFinite(start)) return false
  if (Math.abs(kickoff - start) > KICKOFF_TOLERANCE_MS) return false

  const { home, away } = espnCompetitors(ev)
  return (
    namesRelated(normalizeName(m.home_name), normalizeName(home?.team?.displayName ?? '')) &&
    namesRelated(normalizeName(m.away_name), normalizeName(away?.team?.displayName ?? ''))
  )
}

/** Placar final do evento ('post'), ou nulls se não-numérico/ausente. */
function espnScores(ev: EspnEvent): { home: number | null; away: number | null } {
  const { home, away } = espnCompetitors(ev)
  const parse = (raw: string | undefined): number | null => {
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 ? n : null
  }
  return { home: parse(home?.score), away: parse(away?.score) }
}

/**
 * Para cada competição em erro: pontua os jogos da janela ativa cujo evento
 * correspondente na ESPN já terminou ('post'). Devolve um mapa compId → nº de
 * jogos atualizados (comps sem jogos na janela, sem mapeamento ou com casamento
 * ambíguo devolvem 0 e nunca lançam).
 *
 * Fail-closed em todas as dúvidas: 0 ou >1 candidatos, placar não-numérico ou
 * estado diferente de 'post' → pula o jogo. Errar por não pontuar é recuperável
 * (o primário volta); pontuar errado não é.
 */
export async function scoreWindowFromEspn(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  compIds: string[],
  opts: EspnFallbackOptions = {},
): Promise<Map<string, number>> {
  const updatedByComp = new Map<string, number>()
  if (compIds.length === 0) return updatedByComp

  // Mesma janela do poller (ADR-007): start_time entre now-200min e now-115min,
  // em ISO 8601 com T/Z para a comparação TEXT ficar lexicográfica.
  const now = opts.now ?? Date.now()
  const earliestOver = new Date(now - 115 * 60 * 1000).toISOString()
  const stillRelevant = new Date(now - 200 * 60 * 1000).toISOString()

  for (const compId of compIds) {
    try {
      const updated = await scoreCompetitionWindow(db, ae, compId, earliestOver, stillRelevant)
      updatedByComp.set(compId, updated)
    } catch (err) {
      // Erro de fetch/parsing isola a competição — as demais continuam. Devolve
      // 0 para o mapa cobrir todas as comps pedidas (0 = nada atualizado).
      updatedByComp.set(compId, 0)
      logError(ae, 'match_results_fallback', `[espn-fallback] Falhou comp=${compId}:`, err, {
        blobs: [compId],
      })
    }
  }

  return updatedByComp
}

async function scoreCompetitionWindow(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  compId: string,
  earliestOver: string,
  stillRelevant: string,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.start_time,
              th.name AS home_name,
              ta.name AS away_name,
              c.external_id AS comp_code
         FROM matches m
         JOIN teams th ON th.id = m.home_team_id
         JOIN teams ta ON ta.id = m.away_team_id
         JOIN competitions c ON c.id = m.competition_id
        WHERE m.competition_id = ?
          AND m.start_time <= ?
          AND m.start_time >= ?
          AND m.status != 'finished'`,
    )
    .bind(compId, earliestOver, stillRelevant)
    .all<WindowMatch>()

  if (results.length === 0) return 0

  const compCode = results[0].comp_code
  const slug = compCode ? FOOTBALL_DATA_TO_ESPN[compCode] : undefined
  if (!slug) {
    console.info(
      `[espn-fallback] Competição ${compId} (código ${compCode}) sem mapeamento ESPN — fallback não se aplica.`,
    )
    return 0
  }

  // A ESPN agrupa os eventos por dia norte-americano: um jogo às 00:30Z entra no
  // scoreboard da data UTC do dia ANTERIOR (validado ao vivo — São Paulo×Cruzeiro
  // 2026-10-08T00:30Z aparece em dates=20261007). Por isso buscamos o dia UTC de
  // cada jogo E o anterior; com qualquer fronteira de fuso fixa [X-k, X+k), esses
  // dois dias cobrem todos os eventos cujo kickoff cai na data UTC do jogo.
  const dates = new Set<string>()
  for (const m of results) {
    const day = m.start_time.slice(0, 10)
    dates.add(day.replaceAll('-', ''))
    dates.add(new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10).replaceAll('-', ''))
  }

  const events: EspnEvent[] = []
  for (const date of dates) {
    events.push(...(await fetchEspnScoreboard(slug, date)))
  }

  let updated = 0
  let skipped = 0
  const updateStmt = db.prepare(
    `UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ? AND status != 'finished'`,
  )

  for (const m of results) {
    const candidates = events.filter((ev) => matchesEvent(m, ev))
    // Casa ambígua (ou nenhuma) → pula: nunca pontuar na dúvida.
    if (candidates.length !== 1) {
      skipped++
      continue
    }
    const ev = candidates[0]
    if (ev.status?.type?.state !== 'post') {
      skipped++
      continue
    }
    const { home, away } = espnScores(ev)
    if (home === null || away === null) {
      skipped++
      continue
    }
    // scored_at fica NULL de propósito: scoreUnprocessedMatches pega o jogo na
    // sequência. O guard `status != 'finished'` protege contra corrida com o
    // caminho primário.
    await updateStmt.bind(home, away, m.id).run()
    updated++
  }

  logEvent(ae, 'match_results_fallback', {
    blobs: [compId],
    doubles: [updated, skipped],
  })

  return updated
}
