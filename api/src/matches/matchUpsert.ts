import type { D1Database } from '@cloudflare/workers-types'
import { tryLogEvent } from '../observability/events'
import { runInBatches } from '../d1Batch'

// Camada de gravação de jogos e times dos dois provedores (football-data e ESPN).
// Cada adaptador converte o calendário em `MatchUpsertRow` e chama `writeMatchUpserts`.

export type SyncResult = {
  competition: string
  competitionId: string
  matches: number
  teams: number
  /** Eventos do provedor que o sync não importou (motivos em `sync_event_discarded`). */
  discarded: number
  /**
   * Dos descartados, os jogos com time ainda indefinido (`missing_competitor`/`tbd`):
   * o calendário tem jogo que ainda não pode ser gravado.
   */
  discardedTbd: number
  /** Jogos pendentes que o calendário completo não trouxe (`match_missing_from_feed`). */
  missing: number
}

/**
 * Por que o sync não importou um evento do provedor. `unknown_stage`: fase fora
 * do mapa da ESPN; `season_mismatch`: evento de outra edição; `missing_competitor`:
 * time ausente ou ainda indefinido; `invalid_event`: id, data ou confronto inválidos.
 */
export type SyncDiscard = {
  reason: 'unknown_stage' | 'season_mismatch' | 'missing_competitor' | 'invalid_event'
  /** Slug da fase, ano da edição recebida, `tbd` ou o campo inválido; vazio se não há. */
  detail: string
}

/** ISO 8601 sem milissegundos, no mesmo formato de `start_time`. */
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Horário do provedor no formato que `matches.start_time` aceita
 * (`YYYY-MM-DDTHH:MM:SSZ`, migration 0043), ou null se a data não é válida.
 * Milissegundos e fuso são normalizados; o sync descarta a data inválida em vez
 * de deixar o gatilho derrubar o lote inteiro.
 */
export function resolveStartTime(rawDate: unknown): string | null {
  if (typeof rawDate !== 'string') return null
  const parsed = Date.parse(rawDate)
  if (!Number.isFinite(parsed)) return null
  return isoSeconds(new Date(parsed))
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Competição pela chave do provedor, ou vazio. Falha de leitura também vira vazio. */
async function findCompetitionId(
  db: D1Database,
  provider: string,
  externalId: string,
  season: number,
): Promise<string> {
  try {
    const row = await db
      .prepare(`SELECT id FROM competitions WHERE provider = ? AND external_id = ? AND season = ?`)
      .bind(provider, externalId, String(season))
      .first<{ id: string }>()
    return row?.id ?? ''
  } catch {
    return ''
  }
}

/**
 * Registra os eventos que o sync não importou, um `sync_event_discarded` por
 * motivo e detalhe com a quantidade, e devolve o total. Sem `competitionId` (o
 * sync não chegou a gravar jogo), procura a competição pela chave do provedor.
 * Nada aqui interrompe o sync: os jogos válidos já foram gravados.
 */
export async function reportDiscards(
  db: D1Database,
  discards: SyncDiscard[],
  scope: {
    ae?: AnalyticsEngineDataset
    provider: string
    competitionCode: string
    season: number
    competitionId?: string
  },
): Promise<number> {
  if (discards.length === 0) return 0
  const competitionId =
    scope.competitionId ??
    (await findCompetitionId(db, scope.provider, scope.competitionCode, scope.season))

  const counts = new Map<string, { discard: SyncDiscard; count: number }>()
  for (const discard of discards) {
    const key = `${discard.reason}\u0000${discard.detail}`
    const entry = counts.get(key) ?? { discard, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  for (const { discard, count } of counts.values()) {
    tryLogEvent(scope.ae, 'sync_event_discarded', {
      blobs: [scope.provider, competitionId, discard.reason, discard.detail, scope.competitionCode],
      doubles: [count],
    })
  }
  return discards.length
}

/** Descartes de jogo com time ainda indefinido (`missing_competitor`/`tbd`). */
export function countTbdDiscards(discards: SyncDiscard[]): number {
  return discards.filter((d) => d.reason === 'missing_competitor' && d.detail === 'tbd').length
}

export type MatchUpsertRow = {
  externalId: string
  homeTeamId: string
  awayTeamId: string
  startTime: string
  status: 'scheduled' | 'finished'
  homeScore: number | null
  awayScore: number | null
  phase: string | null
  round: string
  groupName: string | null
  leg: 1 | 2 | null
  duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT' | null
  penaltyWinner: 'home' | 'away' | null
  homePenaltyGoals: number | null
  awayPenaltyGoals: number | null
  postponed: 0 | 1
  lockedAt: string | null
}

export type MatchResultFields = Pick<
  MatchUpsertRow,
  | 'status'
  | 'homeScore'
  | 'awayScore'
  | 'duration'
  | 'penaltyWinner'
  | 'homePenaltyGoals'
  | 'awayPenaltyGoals'
>

/** Jogo sem resultado final: sem placar, duração nem pênaltis. */
export const NO_RESULT: MatchResultFields = {
  status: 'scheduled',
  homeScore: null,
  awayScore: null,
  duration: null,
  penaltyWinner: null,
  homePenaltyGoals: null,
  awayPenaltyGoals: null,
}

export const MATCH_UPSERT_SQL = `INSERT INTO matches (
       id, competition_id, external_id, provider, home_team_id, away_team_id,
       start_time, status, home_score, away_score, phase, round, group_name,
       duration, penalty_winner, home_penalty_goals, away_penalty_goals, postponed,
       locked_at, leg
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )
     ON CONFLICT (external_id, provider) DO UPDATE SET
       -- Travamento permanente: uma vez preenchido, locked_at não volta a NULL. É
       -- preenchido quando o provedor informa início ou a linha anterior já
       -- estava travada por status ou horário. No DO UPDATE, matches.* são os
       -- valores antigos. O parâmetro 21 é o instante do sync, comum aos provedores.
       locked_at          = COALESCE(
                              matches.locked_at,
                              CASE WHEN matches.status IN ('live', 'finished')
                                     OR (matches.postponed = 0 AND matches.start_time <= strftime('%Y-%m-%dT%H:%M:%SZ', ?21))
                                   THEN ?21 END,
                              excluded.locked_at
                            ),
       status             = excluded.status,
       postponed          = excluded.postponed,
       home_score         = excluded.home_score,
       away_score         = excluded.away_score,
       -- Enquanto o jogo está adiado o provider zera o horário para um placeholder
       -- de meia-noite (ex: "2026-07-29T00:00:00Z" nos 4 jogos adiados da rodada 21
       -- do Brasileirão). Gravar isso puxaria o kickoff para ANTES do original e
       -- bagunçaria ordenação e default_round. Preserva-se o horário conhecido até
       -- o provider tirar o POSTPONED com uma data real — aí o UPDATE volta a valer.
       -- Sem heurística de "parece placeholder": 00:00Z é kickoff legítimo no
       -- Brasileirão (21h BRT), então detectar pelo horário daria falso positivo.
       start_time         = CASE WHEN excluded.postponed = 1
                                 THEN matches.start_time ELSE excluded.start_time END,
       -- O provedor também corrige times, fase e rodada de um jogo já gravado. Com
       -- o mando invertido, o gatilho matches_swap_predictions (migration 0039)
       -- inverte os palpites do jogo na mesma instrução.
       home_team_id       = excluded.home_team_id,
       away_team_id       = excluded.away_team_id,
       phase              = excluded.phase,
       round              = excluded.round,
       group_name         = excluded.group_name,
       leg                = excluded.leg,
       duration           = excluded.duration,
       penalty_winner     = excluded.penalty_winner,
       home_penalty_goals = excluded.home_penalty_goals,
       away_penalty_goals = excluded.away_penalty_goals,
       -- If a provider score-correction lands after the match was already
       -- scored, clear scored_at so scoreUnprocessedMatches re-runs and the
       -- points/leaderboard recompute against the final score. Without this,
       -- the displayed score updates but points stay frozen on the stale one
       -- (e.g. exact 4-0 predictors stuck at 1pt after a 3-0→4-0 correction).
       -- penalty_winner também dispara o re-score: o provider pode corrigir só
       -- o vencedor dos pênaltis sem mexer no placar canônico.
       -- Quando o jogo corrigido é a ida de um confronto já encerrado, scoring.ts
       -- repontua a volta junto, porque o classificado depende do agregado.
       -- Times e fase também mudam os pontos: o palpite é lido pela posição dos
       -- times, e a fase decide classificado e pênaltis. Perna e horário podem
       -- mudar qual jogo decide o confronto.
       scored_at  = CASE
         WHEN matches.home_score IS NOT excluded.home_score
           OR matches.away_score IS NOT excluded.away_score
           OR matches.penalty_winner IS NOT excluded.penalty_winner
           OR matches.home_team_id IS NOT excluded.home_team_id
           OR matches.away_team_id IS NOT excluded.away_team_id
           OR matches.phase IS NOT excluded.phase
           OR matches.leg IS NOT excluded.leg
           OR (excluded.postponed IS NOT 1 AND matches.start_time IS NOT excluded.start_time)
         THEN NULL ELSE matches.scored_at END
     -- Uma resposta atrasada do provedor não pode desfazer um resultado final
     -- (inclusive obtido pelo fallback). Correções finais continuam aceitas.
     WHERE (matches.status != 'finished' OR excluded.status = 'finished')
       -- Só grava quando algum campo do SET muda. O sync reenvia a rodada inteira
       -- a cada tick e quase sempre nada mudou; sem este filtro cada jogo custava
       -- uma gravação da linha e dos índices (~75% das gravações do D1). Cada
       -- linha espelha um campo do SET acima (scored_at só muda junto com placar,
       -- penalty_winner ou contexto): ao acrescentar um campo no SET, acrescente aqui.
       AND (
         (matches.locked_at IS NULL
           AND (matches.status IN ('live', 'finished') OR excluded.locked_at IS NOT NULL
             OR (matches.postponed = 0 AND matches.start_time <= strftime('%Y-%m-%dT%H:%M:%SZ', ?21))))
         OR matches.home_team_id       IS NOT excluded.home_team_id
         OR matches.away_team_id       IS NOT excluded.away_team_id
         OR matches.phase              IS NOT excluded.phase
         OR matches.round              IS NOT excluded.round
         OR matches.status             IS NOT excluded.status
         OR matches.postponed          IS NOT excluded.postponed
         OR matches.home_score         IS NOT excluded.home_score
         OR matches.away_score         IS NOT excluded.away_score
         OR (excluded.postponed IS NOT 1 AND matches.start_time IS NOT excluded.start_time)
         OR matches.group_name         IS NOT excluded.group_name
         OR matches.leg                IS NOT excluded.leg
         OR matches.duration           IS NOT excluded.duration
         OR matches.penalty_winner     IS NOT excluded.penalty_winner
         OR matches.home_penalty_goals IS NOT excluded.home_penalty_goals
         OR matches.away_penalty_goals IS NOT excluded.away_penalty_goals
       )`

type TeamChange = { externalId: string; kind: 'swap' | 'replace' }

/**
 * Jogos já gravados que o provedor traz com outros times: `swap` quando só o
 * mando inverteu, `replace` quando um time mudou. Precisa ser lido antes do
 * upsert, que grava os times novos.
 */
async function findTeamChanges(
  db: D1Database,
  provider: string,
  rows: MatchUpsertRow[],
): Promise<TeamChange[]> {
  const { results } = await db
    .prepare(
      `SELECT external_id, home_team_id, away_team_id FROM matches
       WHERE provider = ? AND external_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(provider, JSON.stringify(rows.map((row) => row.externalId)))
    .all<{ external_id: string; home_team_id: string; away_team_id: string }>()
  const stored = new Map(results.map((match) => [match.external_id, match]))
  return rows.flatMap((row) => {
    const old = stored.get(row.externalId)
    if (!old || (old.home_team_id === row.homeTeamId && old.away_team_id === row.awayTeamId)) {
      return []
    }
    const swap = old.home_team_id === row.awayTeamId && old.away_team_id === row.homeTeamId
    return [{ externalId: row.externalId, kind: swap ? 'swap' : 'replace' }]
  })
}

/** Ids internos dos times do provedor, pelo id externo. Id sem time gravado fica de fora. */
export async function loadTeamIds(
  db: D1Database,
  provider: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  const teamIds = new Map<string, string>()
  if (externalIds.length === 0) return teamIds

  const { results } = await db
    .prepare(
      `SELECT external_id, id FROM teams WHERE external_id IN (SELECT value FROM json_each(?)) AND provider = ?`,
    )
    .bind(JSON.stringify(externalIds), provider)
    .all<{ external_id: string; id: string }>()
  for (const row of results) {
    teamIds.set(String(row.external_id), row.id)
  }
  return teamIds
}

/**
 * Grava as linhas com MATCH_UPSERT_SQL e registra `match_teams_changed` para cada
 * jogo que o provedor trouxe com outros times. O bind dos 21 parâmetros fica só
 * aqui.
 */
export async function writeMatchUpserts(
  db: D1Database,
  rows: MatchUpsertRow[],
  scope: { provider: string; competitionId: string; now: string; ae?: AnalyticsEngineDataset },
): Promise<void> {
  if (rows.length === 0) return
  const changes = await findTeamChanges(db, scope.provider, rows)
  const upsertStmt = db.prepare(MATCH_UPSERT_SQL)
  const statements = rows.map((row) =>
    upsertStmt.bind(
      crypto.randomUUID(),
      scope.competitionId,
      row.externalId,
      scope.provider,
      row.homeTeamId,
      row.awayTeamId,
      row.startTime,
      row.status,
      row.homeScore,
      row.awayScore,
      row.phase,
      row.round,
      row.groupName,
      row.duration,
      row.penaltyWinner,
      row.homePenaltyGoals,
      row.awayPenaltyGoals,
      row.postponed,
      row.lockedAt,
      row.leg,
      // Parâmetro 21: instante do sync, usado também na trava por horário da linha anterior.
      scope.now,
    ),
  )
  await runInBatches(db, statements)
  for (const change of changes) {
    tryLogEvent(scope.ae, 'match_teams_changed', {
      blobs: [scope.provider, scope.competitionId, change.externalId, change.kind],
    })
  }
}
