import { openRoundsSql, roundRuleBinds } from '../matches/defaultRound'
import { lockedSql } from '../matches/locking'
import { KNOCKOUT_PHASES } from '../matches/rounds'

/** Fases de mata-mata como lista SQL. São constantes do código, sem entrada do usuário. */
const KNOCKOUT_PHASES_SQL = KNOCKOUT_PHASES.map((phase) => `'${phase}'`).join(', ')

/** Chave de prazo `start_time|fora|id`, só para jogo com horário futuro e sem adiamento. */
const DEADLINE_KEY_SQL = `CASE WHEN m.postponed = 0 AND m.start_time > ?
                THEN m.start_time || '|' || (r.position <> 1) || '|' || m.id END`

/**
 * Resumo dos jogos abertos do grupo para o painel, numa subquery correlacionada
 * ao grupo que devolve um objeto JSON. Os jogos são os mesmos da contagem de
 * palpites pendentes:
 *
 * 1. os jogos abertos da rodada que `GET /matches` escolhe como `default_round`
 *    (`position = 1` em `openRoundsSql`, a mesma ordem de `defaultRoundSql`);
 * 2. os jogos remarcados para o futuro nas outras rodadas que ficaram para trás.
 *    Têm prazo como os da rodada padrão, e a home é o único lugar que avisa
 *    deles antes de o usuário abrir o grupo. Adiado guarda o horário original
 *    (ADR-013). Com esse horário já passado, ele fica fora desta parcela.
 *
 * Campos do JSON, lidos por `parsePendingSummary`:
 *
 * - `pending`: jogos sem palpite do usuário no grupo.
 * - `deadline`: `start_time|fora|id` do jogo sem palpite que começa primeiro,
 *   com `fora` = 1 para jogo de fora da rodada padrão. No empate de horário
 *   vence o jogo da rodada padrão e depois o menor `id`. Só conta jogo com
 *   horário futuro e sem adiamento. O adiado entra em `pending` e fica sem
 *   prazo. O horário dele pode ser o original, ainda futuro, e o jogo não
 *   acontece nesse horário.
 * - `next_match_at`: horário do próximo jogo não adiado, com ou sem palpite.
 * - `round`: a rodada padrão.
 * - `round_ends_at`: horário do último jogo aberto da rodada padrão. Quando ele
 *   começa, a rodada seguinte vira padrão e traz pendências novas.
 * - `penalty_candidates`: jogos palpitados que podem pedir o vencedor dos
 *   pênaltis: os de mata-mata, menos a ida com `leg` informado, e os de fase que
 *   vai aos pênaltis. Quem decide se falta o pênalti é `missingPenalties`, que lê
 *   o palpite e o da ida e acha o papel no confronto com `indexTies`, em TS. Em
 *   liga, a lista fica vazia. O palpite não é lido aqui: o índice único de
 *   `predictions` responde se ele existe sem ler a linha.
 *
 * Tudo sai de uma varredura só do índice coberto da competição, que numera as
 * candidatas e já traz a rodada padrão e as que ficaram para trás. Os jogos de
 * cada rodada vêm de `idx_matches_comp_round_start` com a rodada já resolvida,
 * e o palpite de cada jogo vem do índice único de `predictions`. O `CROSS JOIN`
 * fixa essa ordem. Com `JOIN` o SQLite pode começar pelos jogos e varrer a
 * competição. Um campo a mais no painel entra neste JSON. Outra subquery por
 * campo leria o índice da competição de novo para cada grupo.
 *
 * Sem rodada aberta, `pending` fica 0 e os horários ficam nulos.
 *
 * Aberto para submissão = `NOT lockedSql` (ADR-004): respeita `locked_at`,
 * live/finished e adiados (`postponed = 1` com horário passado continua aberto
 * até o sync marcar início). Palpite 0x0 já gravado conta como preenchido,
 * porque a linha existe em `predictions`. TBD não entra: o sync ESPN descarta
 * placeholders antes de persistir.
 *
 * Fragmento correlacionado ao alias do grupo (padrão `g`) e ao da competição
 * do grupo (padrão `c`), de onde vem `penalty_phases`, sem ler `competitions` de
 * novo a cada jogo. Quando `openRoundsJsonExpr` é informado, lê as rodadas
 * abertas já serializadas na CTE de competições e consome os binds de
 * `pendingSummaryCteBinds`; sem esse argumento, calcula inline com
 * `pendingSummaryBinds`.
 */
export function pendingSummarySql(
  groupAlias = 'g',
  competitionAlias = 'c',
  openRoundsJsonExpr?: string,
): string {
  const competition = `${groupAlias}.competition_id`
  const penaltyPhases = `${competitionAlias}.penalty_phases`
  const roundsSource = openRoundsJsonExpr
    ? `(
              SELECT
                json_extract(je.value, '$.round') AS round,
                json_extract(je.value, '$.position') AS position
              FROM json_each(COALESCE(${openRoundsJsonExpr}, '[]')) je
            ) r`
    : `(${openRoundsSql(competition, 'mr')}) r`
  return `(
            SELECT json_object(
              'pending', COUNT(*) - COUNT(p.match_id),
              'deadline', MIN(CASE WHEN p.match_id IS NULL THEN ${DEADLINE_KEY_SQL} END),
              'next_match_at', MIN(CASE WHEN m.postponed = 0 AND m.start_time > ? THEN m.start_time END),
              'penalty_candidates', json_group_array(
                json_object('match_id', m.id, 'phase', m.phase, 'deadline', ${DEADLINE_KEY_SQL})
              ) FILTER (
                WHERE p.match_id IS NOT NULL
                  AND (m.leg IS NULL OR m.leg = 2)
                  AND (
                    m.phase IN (${KNOCKOUT_PHASES_SQL})
                    OR m.phase IN (
                      SELECT value
                      FROM json_each(iif(json_valid(${penaltyPhases}), ${penaltyPhases}, '[]'))
                    )
                  )
              ),
              'round', MIN(CASE WHEN r.position = 1 THEN r.round END),
              'round_ends_at', MAX(CASE WHEN r.position = 1 THEN m.start_time END)
            )
            FROM ${roundsSource}
            CROSS JOIN matches m
              ON m.competition_id = ${competition}
             AND m.round = r.round
            LEFT JOIN predictions p
              ON p.user_id = ?
             AND p.group_id = ${groupAlias}.id
             AND p.match_id = m.id
            WHERE (r.position = 1 OR m.start_time > ?)
              AND NOT ${lockedSql('m')}
          )`
}

/** Binds na ordem exigida por `pendingSummarySql` sem CTE. */
export function pendingSummaryBinds(nowIso: string, userId: string): string[] {
  return [nowIso, nowIso, nowIso, ...roundRuleBinds(nowIso), userId, nowIso, nowIso]
}

/** Binds na ordem exigida por `pendingSummarySql` com `openRoundsJsonExpr`. */
export function pendingSummaryCteBinds(nowIso: string, userId: string): string[] {
  return [nowIso, nowIso, nowIso, userId, nowIso, nowIso]
}

/** Jogo palpitado que pode pedir o pênalti, a conferir em `missingPenalties`. */
export type PenaltyCandidate = {
  match_id: string
  phase: string
  /** Chave de prazo `start_time|fora|id`. Null para adiado ou horário passado. */
  deadline: string | null
}

export type PendingSummary = {
  pending: number
  /** Jogo sem palpite (ou com pênalti faltando) que começa primeiro. */
  deadline: { match_id: string; start_time: string } | null
  /** Chave crua de `deadline`, para comparar com a dos pênaltis faltando. */
  deadline_key: string | null
  next_match_at: string | null
  round: string | null
  round_ends_at: string | null
  penalty_candidates: PenaltyCandidate[]
}

const EMPTY_SUMMARY: PendingSummary = {
  pending: 0,
  deadline: null,
  deadline_key: null,
  next_match_at: null,
  round: null,
  round_ends_at: null,
  penalty_candidates: [],
}

/** Separa `start_time|fora|id` em horário e jogo. Chave fora do formato vira null. */
function parseDeadlineKey(key: string | null): PendingSummary['deadline'] {
  if (!key) return null
  const first = key.indexOf('|')
  const second = key.indexOf('|', first + 1)
  if (first <= 0 || second < 0 || second === key.length - 1) return null
  return { start_time: key.slice(0, first), match_id: key.slice(second + 1) }
}

/** Lê o JSON de `pendingSummarySql`. Valor ausente ou inválido vira resumo vazio. */
export function parsePendingSummary(raw: string | null | undefined): PendingSummary {
  if (!raw) return EMPTY_SUMMARY
  let value: Record<string, unknown>
  try {
    value = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return EMPTY_SUMMARY
  }
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  const deadline = parseDeadlineKey(text(value.deadline))
  return {
    pending: typeof value.pending === 'number' ? value.pending : 0,
    deadline,
    deadline_key: deadline ? text(value.deadline) : null,
    next_match_at: text(value.next_match_at),
    round: text(value.round),
    round_ends_at: text(value.round_ends_at),
    penalty_candidates: parsePenaltyCandidates(value.penalty_candidates),
  }
}

function parsePenaltyCandidate(raw: unknown): PenaltyCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const { match_id, phase, deadline } = raw as Record<string, unknown>
  if (typeof match_id !== 'string' || typeof phase !== 'string') return null
  return { match_id, phase, deadline: typeof deadline === 'string' ? deadline : null }
}

/** Lista de `penalty_candidates`. Item fora do formato é descartado. */
function parsePenaltyCandidates(raw: unknown): PenaltyCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => parsePenaltyCandidate(item) ?? [])
}

/**
 * Soma ao resumo os palpites em que falta o pênalti. Eles contam como pendentes,
 * como na aba Palpitar, e podem ser o prazo: vale a menor chave
 * `start_time|fora|id`, a mesma ordem do SQL.
 */
export function withMissingPenalties(
  summary: PendingSummary,
  missing: readonly PenaltyCandidate[],
): PendingSummary {
  if (missing.length === 0) return summary
  let deadlineKey = summary.deadline_key
  for (const candidate of missing) {
    if (candidate.deadline && (deadlineKey === null || candidate.deadline < deadlineKey)) {
      deadlineKey = candidate.deadline
    }
  }
  return {
    ...summary,
    pending: summary.pending + missing.length,
    deadline: parseDeadlineKey(deadlineKey),
    deadline_key: deadlineKey,
  }
}
