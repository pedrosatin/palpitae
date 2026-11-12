import {
  discardDetailLabel,
  discardReasonLabel,
  httpContextLabel,
  providerLabel,
  syncErrorOriginLabel,
} from './labels'
import styles from './AdminMetricsPage.module.css'

/**
 * Operação dos provedores de partidas (ESPN e football-data.org): tentativas
 * HTTP, erros de sync, fallback de resultados, eventos que o sync descartou e
 * jogos pendentes que sumiram do calendário, por processo e campeonato.
 * Consome GET /metrics/ops (Analytics Engine).
 *
 * Duas ressalvas guiam a leitura dos números:
 * - falhas (4xx/5xx e "sem resposta") são todas registradas; sucessos entram
 *   numa amostra de ~10% e já chegam ponderados — por isso aparecem como "≈";
 * - linha ausente é falta de evento, não zero chamadas: a coleta pode ser mais
 *   nova que o período, ou a competição pode não ter rodado.
 */

export interface OpsResponse {
  days: number
  httpFirstSeenAt: string | null
  httpByProvider: OpsHttpRow[]
  httpByCompetition: (OpsHttpRow & { competition_id: string })[]
  apiErrors: { context: string; competition_id: string; count: number }[]
  fallback: {
    competition_id: string
    runs: number
    updated: number
    skipped: number
    failures: number
  }[]
  /** Ausente em API anterior ao registro de descartes. */
  discards?: OpsDiscardRow[]
  /** Ausente em API anterior ao registro de jogos fora do calendário. */
  missingMatches?: OpsMissingMatchRow[]
}

interface OpsDiscardRow {
  provider: string
  competition_id: string
  competition_code: string
  reason: string
  detail: string
  events: number
  syncs: number
}

interface OpsMissingMatchRow {
  provider: string
  competition_id: string
  external_id: string
  start_time: string
  times: number
  last_seen: string
}

interface OpsHttpRow {
  provider: string
  context?: string
  status: string
  attempts: number
  events: number
  avg_ms: number
  max_ms: number
}

/** Nome e temporada por id de competição (vem do snapshot de /metrics/business). */
export type CompetitionNames = Map<string, { name: string; season: string | null }>

const DAY_MS = 24 * 60 * 60 * 1000

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR')
}

function formatPercent(part: number, total: number): string {
  if (total <= 0) return '—'
  return `${((part / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** "YYYY-MM-DD hh:mm:ss" (UTC da SQL API) → "dd/mm hh:mm UTC". */
export function formatSince(ts: string): string {
  const [date, time] = ts.split(' ')
  if (!date || !time) return ts
  const [, m, d] = date.split('-')
  return `${d}/${m} ${time.slice(0, 5)} UTC`
}

/** Sem resposta (status 0) e 4xx/5xx são falhas; 2xx/3xx são sucesso amostrado. */
export function isFailureStatus(status: string): boolean {
  const code = Number(status)
  return code === 0 || code >= 400
}

function statusLabel(status: string): string {
  return Number(status) === 0 ? 'sem resposta' : status
}

type HttpTotals = {
  attempts: number
  failures: number
  sampled: boolean
  weightedMs: number
  failuresByStatus: Map<string, number>
}

/** Soma linhas HTTP por chave (ex.: provedor+processo, competição+provedor). */
export function summarizeHttp<T extends OpsHttpRow>(
  rows: T[],
  keyOf: (row: T) => string,
): Map<string, HttpTotals> {
  const out = new Map<string, HttpTotals>()
  for (const row of rows) {
    const key = keyOf(row)
    const t = out.get(key) ?? {
      attempts: 0,
      failures: 0,
      sampled: false,
      weightedMs: 0,
      failuresByStatus: new Map<string, number>(),
    }
    t.attempts += row.attempts
    t.weightedMs += row.avg_ms * row.attempts
    if (isFailureStatus(row.status)) {
      t.failures += row.attempts
      t.failuresByStatus.set(row.status, (t.failuresByStatus.get(row.status) ?? 0) + row.attempts)
    } else {
      t.sampled = true
    }
    out.set(key, t)
  }
  return out
}

/** Total de falhas HTTP no período (para o alerta do topo). */
export function totalHttpFailures(ops: OpsResponse | null): number {
  if (!ops || !Array.isArray(ops.httpByProvider)) return 0
  return Math.round(
    ops.httpByProvider
      .filter((r) => isFailureStatus(r.status))
      .reduce((sum, r) => sum + r.attempts, 0),
  )
}

function failureBreakdown(totals: HttpTotals): string {
  const parts = [...totals.failuresByStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${statusLabel(status)} ×${formatNumber(Math.round(count))}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function Attempts({ totals }: { totals: HttpTotals }) {
  const value = formatNumber(Math.round(totals.attempts))
  if (!totals.sampled) return <>{value}</>
  return (
    <span title="Estimativa: os sucessos são amostrados (~10%) e ponderados; as falhas são todas registradas.">
      ≈{value}
    </span>
  )
}

function competitionName(id: string, names: CompetitionNames): { text: string; title?: string } {
  if (!id) return { text: 'sem liga', title: 'Evento sem competição associada' }
  const found = names.get(id)
  if (!found) return { text: `Campeonato ${id.slice(0, 8)}`, title: id }
  return { text: found.season ? `${found.name} ${found.season}` : found.name, title: id }
}

/** Aviso sobre o que a ausência de linhas significa neste período. */
function CollectionNotice({ ops }: { ops: OpsResponse }) {
  if (!ops.httpFirstSeenAt) {
    return (
      <p className={styles.samplingWarning}>
        Nenhuma tentativa HTTP foi registrada ainda: a coleta é recente ou o deploy não chegou ao
        Worker. Isso é falta de dado, não zero falhas.
      </p>
    )
  }
  const first = new Date(`${ops.httpFirstSeenAt.replace(' ', 'T')}Z`).getTime()
  if (Number.isFinite(first) && first > Date.now() - ops.days * DAY_MS) {
    return (
      <p className={styles.samplingWarning}>
        A coleta de tentativas HTTP começou em {formatSince(ops.httpFirstSeenAt)}; antes disso não
        há dados, e isso não significa zero falhas.
      </p>
    )
  }
  return null
}

function HttpByProcess({ ops }: { ops: OpsResponse }) {
  const totals = summarizeHttp(ops.httpByProvider, (r) => `${r.provider}\u0000${r.context ?? ''}`)
  if (totals.size === 0) {
    return <p className={styles.hint}>Nenhuma tentativa HTTP registrada no período.</p>
  }
  const rows = [...totals.entries()].sort(
    (a, b) => b[1].failures - a[1].failures || b[1].attempts - a[1].attempts,
  )
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table} aria-label="Tentativas HTTP por provedor e processo">
        <thead>
          <tr>
            <th>provedor</th>
            <th>processo</th>
            <th className={styles.num}>tentativas</th>
            <th className={styles.num}>falhas</th>
            <th className={styles.num}>% falha</th>
            <th>status das falhas</th>
            <th className={styles.num}>duração média</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, t]) => {
            const [provider, context] = key.split('\u0000')
            return (
              <tr key={key}>
                <td className={styles.nowrap}>{providerLabel(provider)}</td>
                <td className={styles.nowrap} title={context}>
                  {httpContextLabel(context)}
                </td>
                <td className={styles.num}>
                  <Attempts totals={t} />
                </td>
                <td className={`${styles.num} ${t.failures > 0 ? styles.statusError : ''}`}>
                  {formatNumber(Math.round(t.failures))}
                </td>
                <td className={styles.num}>{formatPercent(t.failures, t.attempts)}</td>
                <td className={styles.detail}>{failureBreakdown(t)}</td>
                <td className={styles.num}>
                  {t.attempts > 0 ? formatMs(t.weightedMs / t.attempts) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function HttpByCompetition({ ops, names }: { ops: OpsResponse; names: CompetitionNames }) {
  const totals = summarizeHttp(
    ops.httpByCompetition,
    (r) => `${r.competition_id}\u0000${r.provider}`,
  )
  if (totals.size === 0) return null
  const rows = [...totals.entries()].sort(
    (a, b) => b[1].failures - a[1].failures || b[1].attempts - a[1].attempts,
  )
  return (
    <>
      <h3 className={styles.subTitle}>Tentativas HTTP por campeonato</h3>
      <p className={styles.hint}>
        Só campeonatos com evento no período. Linha ausente é falta de dado, não prova de zero
        chamadas.
      </p>
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="Tentativas HTTP por campeonato">
          <thead>
            <tr>
              <th>campeonato</th>
              <th>provedor</th>
              <th className={styles.num}>tentativas</th>
              <th className={styles.num}>falhas</th>
              <th className={styles.num}>% falha</th>
              <th>status das falhas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, t]) => {
              const [competitionId, provider] = key.split('\u0000')
              const name = competitionName(competitionId, names)
              return (
                <tr key={key}>
                  <td title={name.title}>{name.text}</td>
                  <td className={styles.nowrap}>{providerLabel(provider)}</td>
                  <td className={styles.num}>
                    <Attempts totals={t} />
                  </td>
                  <td className={`${styles.num} ${t.failures > 0 ? styles.statusError : ''}`}>
                    {formatNumber(Math.round(t.failures))}
                  </td>
                  <td className={styles.num}>{formatPercent(t.failures, t.attempts)}</td>
                  <td className={styles.detail}>{failureBreakdown(t)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

type SyncRow = {
  id: string
  errorsByOrigin: Map<string, number>
  errors: number
  runs: number
  updated: number
  failures: number
}

function SyncAndFallback({ ops, names }: { ops: OpsResponse; names: CompetitionNames }) {
  const byComp = new Map<string, SyncRow>()
  const rowFor = (id: string): SyncRow => {
    const row = byComp.get(id) ?? {
      id,
      errorsByOrigin: new Map<string, number>(),
      errors: 0,
      runs: 0,
      updated: 0,
      failures: 0,
    }
    byComp.set(id, row)
    return row
  }
  for (const e of ops.apiErrors) {
    const row = rowFor(e.competition_id)
    row.errors += e.count
    row.errorsByOrigin.set(e.context, (row.errorsByOrigin.get(e.context) ?? 0) + e.count)
  }
  for (const f of ops.fallback) {
    const row = rowFor(f.competition_id)
    row.runs += f.runs
    row.updated += f.updated
    row.failures += f.failures
  }

  if (byComp.size === 0) {
    return (
      <p className={styles.hint}>
        Nenhum erro de sync nem execução do fallback de resultados no período.
      </p>
    )
  }
  const rows = [...byComp.values()].sort(
    (a, b) => b.errors + b.failures - (a.errors + a.failures) || b.runs - a.runs,
  )
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table} aria-label="Erros de sync e fallback por campeonato">
        <thead>
          <tr>
            <th>campeonato</th>
            <th className={styles.num}>erros de sync</th>
            <th>origem dos erros</th>
            <th className={styles.num}>fallback: execuções</th>
            <th className={styles.num}>fallback: jogos atualizados</th>
            <th className={styles.num}>fallback: falhas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const name = competitionName(r.id, names)
            const origins = [...r.errorsByOrigin.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([origin, count]) => `${syncErrorOriginLabel(origin)} ×${formatNumber(count)}`)
            return (
              <tr key={r.id || 'sem-liga'}>
                <td title={name.title}>{name.text}</td>
                <td className={`${styles.num} ${r.errors > 0 ? styles.statusError : ''}`}>
                  {formatNumber(r.errors)}
                </td>
                <td className={styles.detail}>{origins.length > 0 ? origins.join(' · ') : '—'}</td>
                <td className={styles.num}>{formatNumber(r.runs)}</td>
                <td className={styles.num}>{formatNumber(r.updated)}</td>
                <td className={`${styles.num} ${r.failures > 0 ? styles.statusError : ''}`}>
                  {formatNumber(r.failures)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Campeonato pelo id; sem competição gravada, o código do provedor. */
function discardCompetition(row: OpsDiscardRow, names: CompetitionNames) {
  if (row.competition_id || !row.competition_code) return competitionName(row.competition_id, names)
  return { text: row.competition_code, title: 'Competição ainda não gravada no banco' }
}

/** "2026-12-06T16:30:00Z" → "06/12 16:30 UTC". */
function formatKickoff(iso: string): string {
  return iso ? formatSince(iso.replace('T', ' ').replace('Z', '')) : '—'
}

function DiscardsTable({ rows, names }: { rows: OpsDiscardRow[]; names: CompetitionNames }) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table} aria-label="Eventos descartados pelo sync">
        <thead>
          <tr>
            <th>campeonato</th>
            <th>provedor</th>
            <th>motivo</th>
            <th>detalhe</th>
            <th className={styles.num}>eventos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const name = discardCompetition(r, names)
            return (
              <tr
                key={`${r.provider}|${r.competition_id}|${r.competition_code}|${r.reason}|${r.detail}`}
              >
                <td title={name.title}>{name.text}</td>
                <td className={styles.nowrap}>{providerLabel(r.provider)}</td>
                <td className={styles.nowrap} title={r.reason}>
                  {discardReasonLabel(r.reason)}
                </td>
                <td className={styles.detail} title={r.detail}>
                  {r.detail ? discardDetailLabel(r.detail) : '—'}
                </td>
                <td className={styles.num}>{formatNumber(r.events)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MissingMatchesTable({
  rows,
  names,
}: {
  rows: OpsMissingMatchRow[]
  names: CompetitionNames
}) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table} aria-label="Jogos pendentes fora do calendário">
        <thead>
          <tr>
            <th>campeonato</th>
            <th>id no provedor</th>
            <th>início</th>
            <th className={styles.num}>registros</th>
            <th>último registro</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const name = competitionName(r.competition_id, names)
            return (
              <tr key={`${r.provider}|${r.competition_id}|${r.external_id}|${r.start_time}`}>
                <td title={name.title}>{name.text}</td>
                <td className={styles.nowrap} title={providerLabel(r.provider)}>
                  {r.external_id || '—'}
                </td>
                <td className={styles.nowrap}>{formatKickoff(r.start_time)}</td>
                <td className={styles.num}>{formatNumber(r.times)}</td>
                <td className={styles.nowrap}>{formatSince(r.last_seen)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Eventos que o sync não importou. Some quando a API ainda não envia o campo,
 * para não afirmar zero sem dado.
 */
function Discards({ ops, names }: { ops: OpsResponse; names: CompetitionNames }) {
  if (!Array.isArray(ops.discards)) return null
  return (
    <>
      <h3 className={styles.subTitle}>Eventos descartados pelo sync</h3>
      <p className={styles.hint}>
        O sync descarta o que não consegue importar (fase desconhecida, outra temporada, time
        ausente) e segue com os demais jogos.
      </p>
      {ops.discards.length === 0 ? (
        <p className={styles.hint}>Nenhum evento descartado no período.</p>
      ) : (
        <DiscardsTable rows={ops.discards} names={names} />
      )}
    </>
  )
}

/**
 * Jogos pendentes que a descoberta não viu no calendário completo da
 * football-data. Some quando a API ainda não envia o campo.
 */
function MissingMatches({ ops, names }: { ops: OpsResponse; names: CompetitionNames }) {
  if (!Array.isArray(ops.missingMatches)) return null
  return (
    <>
      <h3 className={styles.subTitle}>Jogos pendentes fora do calendário</h3>
      <p className={styles.hint}>
        Jogos ainda não encerrados que a descoberta deixou de ver na temporada da football-data,
        como um jogo reemitido com outro id. A linha e os palpites continuam no banco.
      </p>
      {ops.missingMatches.length === 0 ? (
        <p className={styles.hint}>Nenhum jogo pendente fora do calendário no período.</p>
      ) : (
        <MissingMatchesTable rows={ops.missingMatches} names={names} />
      )}
    </>
  )
}

/** A resposta pode vir de uma API antiga ou truncada: só renderiza o que tem forma. */
function isUsable(ops: OpsResponse | null): ops is OpsResponse {
  return (
    !!ops &&
    Array.isArray(ops.httpByProvider) &&
    Array.isArray(ops.httpByCompetition) &&
    Array.isArray(ops.apiErrors) &&
    Array.isArray(ops.fallback)
  )
}

export default function ProviderOpsSection({
  ops,
  names,
}: {
  ops: OpsResponse | null
  names: CompetitionNames
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Provedores de partidas · falhas e carga</h2>
      {!isUsable(ops) ? (
        <p className={styles.hint}>
          Indisponível: a API não enviou a telemetria de provedores (deploy pendente ou falha na
          consulta). Isso não significa zero falhas.
        </p>
      ) : (
        <>
          <p className={styles.hint}>
            Cobre football-data.org e ESPN. Falhas HTTP (4xx/5xx e sem resposta) são todas
            registradas; sucessos entram numa amostra de ~10% e aparecem como estimativa (≈).
          </p>
          <CollectionNotice ops={ops} />
          <h3 className={styles.subTitle}>Tentativas HTTP por provedor e processo</h3>
          <HttpByProcess ops={ops} />
          <HttpByCompetition ops={ops} names={names} />
          <h3 className={styles.subTitle}>Erros de sync e fallback por campeonato</h3>
          <p className={styles.hint}>
            Erros de sync valem para qualquer provedor (poller, descoberta e sincronização manual).
            O fallback recupera placares pela ESPN quando o provedor primário atrasa ou falha.
          </p>
          <SyncAndFallback ops={ops} names={names} />
          <Discards ops={ops} names={names} />
          <MissingMatches ops={ops} names={names} />
        </>
      )}
    </section>
  )
}
