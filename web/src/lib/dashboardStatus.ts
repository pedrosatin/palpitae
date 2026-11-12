// Status de cada grupo no painel, ordem por urgência e faixa "Próximo prazo".
// Os números vêm prontos do `GET /groups`, calculados em
// api/src/groups/pendingPredictions.ts pela mesma regra de rodada padrão da aba
// Palpitar. Aqui fica só a escolha da mensagem, a ordem e o texto, com horários
// no fuso de Brasília como no resto do app.

/** Jogo sem palpite que fecha primeiro no grupo. */
export interface DeadlineMatch {
  match_id: string
  start_time: string
  /** Rodada crua, para abrir a aba Palpitar nela. */
  round: string
  round_label: string
  home_team: string
  away_team: string
}

/**
 * Campos do `GET /groups` usados aqui. Opcionais porque o web pode entrar no ar
 * antes da API, que tem deploy próprio, ou a API pode voltar por rollback.
 */
export interface RoundStatusFields {
  id: string
  name: string
  pending_predictions: number
  next_deadline?: DeadlineMatch | null
  next_match_at?: string | null
  current_round_label?: string | null
  round_ends_at?: string | null
  live_matches?: number
}

/**
 * Horários em que os números do painel mudam sem ação do usuário: o início do jogo
 * de prazo (sai da pendência), o do próximo jogo (fica ao vivo) e o fim da rodada
 * padrão (a seguinte vira padrão e traz pendências novas). Adiado sem data nova
 * não tem horário aqui e segue pendente.
 */
export function statusBoundaries(groups: RoundStatusFields[]): string[] {
  return groups.flatMap((group) =>
    [group.next_deadline?.start_time, group.next_match_at, group.round_ends_at].filter(
      (time): time is string => Boolean(time),
    ),
  )
}

/** O mais recente de `boundaries` que já passou em `nowMs`, em ms. Null quando nenhum passou. */
export function lastPassedBoundary(boundaries: readonly string[], nowMs: number): number | null {
  let last: number | null = null
  for (const boundary of boundaries) {
    const at = Date.parse(boundary)
    if (at <= nowMs && (last === null || at > last)) last = at
  }
  return last
}

export type GroupRoundStatus =
  | { kind: 'pending'; count: number; deadline: string | null }
  | { kind: 'live'; count: number }
  | { kind: 'complete'; roundLabel: string | null; nextMatchAt: string }
  | { kind: 'empty' }

/**
 * Uma mensagem por card, nesta ordem: jogos sem palpite, jogo ao vivo, rodada
 * completa com o próximo jogo, sem jogos marcados. Ao vivo vem depois da
 * pendência porque palpitar ainda dá tempo e assistir não pede nada.
 *
 * Devolve null só para a resposta antiga, sem `next_match_at`, quando não há
 * pendência. Sem o campo não dá para separar "completa" de "sem jogos".
 */
export function groupRoundStatus(group: RoundStatusFields): GroupRoundStatus | null {
  if (group.pending_predictions > 0) {
    return {
      kind: 'pending',
      count: group.pending_predictions,
      deadline: group.next_deadline?.start_time ?? null,
    }
  }
  if ((group.live_matches ?? 0) > 0) return { kind: 'live', count: group.live_matches ?? 0 }
  if (group.next_match_at === undefined) return null
  if (group.next_match_at) {
    return {
      kind: 'complete',
      roundLabel: group.current_round_label ?? null,
      nextMatchAt: group.next_match_at,
    }
  }
  return { kind: 'empty' }
}

/** Jogos sem palpite, com os grupos quando são mais de um, como "30 sem palpite em 3 grupos". */
export function pendingCountText(count: number, groups = 1): string {
  return groups > 1 ? `${count} sem palpite em ${groups} grupos` : `${count} sem palpite`
}

/**
 * Partes da linha de status. A primeira leva o "✓" no texto visível quando a
 * rodada está toda palpitada.
 */
function statusParts(
  status: GroupRoundStatus,
  nowMs: number,
): { parts: string[]; complete: boolean } {
  switch (status.kind) {
    case 'pending': {
      const count = pendingCountText(status.count)
      return {
        parts: status.deadline
          ? [count, `fecha ${formatShortWhen(status.deadline, nowMs)}`]
          : [count],
        complete: false,
      }
    }
    case 'live':
      return {
        parts: [status.count === 1 ? '1 jogo ao vivo' : `${status.count} jogos ao vivo`],
        complete: false,
      }
    case 'complete': {
      const done = status.roundLabel
        ? `${status.roundLabel} ${completeWord(status.roundLabel)}`
        : 'Tudo palpitado'
      return {
        parts: [done, `próximo jogo ${formatShortWhen(status.nextMatchAt, nowMs)}`],
        complete: true,
      }
    }
    case 'empty':
      return { parts: ['Sem jogos marcados'], complete: false }
  }
}

/** Texto visível da linha de status, como "Rodada 35 completa ✓ · próximo jogo sáb 18:30". */
export function groupRoundStatusText(status: GroupRoundStatus, nowMs: number): string {
  const { parts, complete } = statusParts(status, nowMs)
  return (complete ? [`${parts[0]} ✓`, ...parts.slice(1)] : parts).join(' · ')
}

/**
 * A linha de status para leitor de tela, sem "✓" e "·", que ele lê como
 * símbolos. Exemplo: "Rodada 35 completa, próximo jogo sáb 18:30".
 */
export function groupRoundStatusLabel(status: GroupRoundStatus, nowMs: number): string {
  return statusParts(status, nowMs).parts.join(', ')
}

type Agreement = 'fs' | 'fp' | 'ms' | 'mp'

/** Gênero e número do `roundLabel` da API, para concordar o adjetivo. */
function roundAgreement(roundLabel: string): Agreement {
  if (/^(Oitavas|Quartas|Semifinais)\b/.test(roundLabel)) return 'fp'
  if (/^Playoffs\b/.test(roundLabel)) return 'mp'
  if (/^(Rebaixamento|Terceiro lugar)\b/.test(roundLabel)) return 'ms'
  return 'fs'
}

const COMPLETE: Record<Agreement, string> = {
  fs: 'completa',
  fp: 'completas',
  ms: 'completo',
  mp: 'completos',
}

const ALL_PREDICTED: Record<Agreement, string> = {
  fs: 'toda palpitada',
  fp: 'todas palpitadas',
  ms: 'todo palpitado',
  mp: 'todos palpitados',
}

/**
 * Concordância de "completa" com o `roundLabel` da API. Exemplos:
 * "Rodada 35 completa", "Semifinais completas", "Playoffs completos".
 */
export function completeWord(roundLabel: string): string {
  return COMPLETE[roundAgreement(roundLabel)]
}

/**
 * Concordância de "toda palpitada" com o `roundLabel` da API. Exemplos:
 * "Rodada 35 toda palpitada", "Semifinais todas palpitadas".
 */
export function allPredictedWord(roundLabel: string): string {
  return ALL_PREDICTED[roundAgreement(roundLabel)]
}

function urgencyTier(group: RoundStatusFields): [number, number] {
  if (group.pending_predictions > 0) {
    const deadline = group.next_deadline?.start_time
    return deadline ? [0, Date.parse(deadline)] : [1, 0]
  }
  if ((group.live_matches ?? 0) > 0) return [2, 0]
  if (group.next_match_at) return [3, Date.parse(group.next_match_at)]
  return [4, 0]
}

/**
 * Ordem do painel. Os grupos com jogo sem palpite vêm primeiro, pelo fechamento
 * mais próximo. Depois vêm os com jogo ao vivo, os demais pela data do próximo
 * jogo e, por último, os sem jogo marcado. Empate mantém a ordem da API.
 */
export function sortByUrgency<T extends RoundStatusFields>(groups: T[]): T[] {
  return groups
    .map((group, index) => ({ group, index, tier: urgencyTier(group) }))
    .sort((a, b) => a.tier[0] - b.tier[0] || a.tier[1] - b.tier[1] || a.index - b.index)
    .map(({ group }) => group)
}

export type DeadlineBanner =
  | {
      kind: 'pending'
      groupId: string
      groupName: string
      /** Null quando o grupo mais urgente só tem adiado sem data nova. */
      match: DeadlineMatch | null
      totalPending: number
      groupsWithPending: number
    }
  | { kind: 'clear'; roundLabel: string }

/**
 * Faixa do topo do painel, a partir dos grupos em andamento.
 *
 * Com pendência, aponta o grupo mais urgente pela mesma ordem dos cards. O total
 * soma os palpites que faltam em cada grupo, então o mesmo jogo em dois grupos
 * conta duas vezes.
 *
 * Sem pendência, diz que a rodada padrão que termina primeiro está toda
 * palpitada. Quando ela termina, a rodada seguinte vira padrão e traz pendências
 * novas. A faixa não diz até quando, porque um jogo da rodada seguinte pode
 * começar antes do fim da rodada padrão. Sem rodada aberta em nenhum grupo, não
 * há faixa.
 */
export function deadlineBanner(groups: RoundStatusFields[]): DeadlineBanner | null {
  const pending = groups.filter((group) => group.pending_predictions > 0)
  if (pending.length > 0) {
    const urgent = sortByUrgency(pending)[0]
    return {
      kind: 'pending',
      groupId: urgent.id,
      groupName: urgent.name,
      match: urgent.next_deadline ?? null,
      totalPending: pending.reduce((sum, group) => sum + group.pending_predictions, 0),
      groupsWithPending: pending.length,
    }
  }

  const rounds = groups
    .flatMap((group) =>
      group.round_ends_at && group.current_round_label
        ? [{ endsAt: Date.parse(group.round_ends_at), label: group.current_round_label }]
        : [],
    )
    .sort((a, b) => a.endsAt - b.endsAt)
  return rounds.length > 0 ? { kind: 'clear', roundLabel: rounds[0].label } : null
}

// ─── Datas no fuso de Brasília ──────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const localFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function localParts(ms: number) {
  const parts: Record<string, string> = {}
  for (const part of localFormat.formatToParts(new Date(ms))) parts[part.type] = part.value
  const dayNumber = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS
  return {
    dayNumber,
    date: `${parts.day}/${parts.month}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[new Date(dayNumber * DAY_MS).getUTCDay()],
  }
}

/**
 * Horário curto para o card: "hoje 18:30", "amanhã 18:30", "sex 18:30" até seis
 * dias à frente, "21/11 18:30" depois disso.
 */
export function formatShortWhen(iso: string, nowMs: number): string {
  const when = localParts(Date.parse(iso))
  const days = when.dayNumber - localParts(nowMs).dayNumber
  if (days === 0) return `hoje ${when.time}`
  if (days === 1) return `amanhã ${when.time}`
  if (days > 1 && days < 7) return `${when.weekday} ${when.time}`
  return `${when.date} ${when.time}`
}

/** Horário com data para a faixa: "hoje às 18:30", "amanhã às 18:30", "sáb, 14/11 às 18:30". */
export function formatLongWhen(iso: string, nowMs: number): string {
  const when = localParts(Date.parse(iso))
  const days = when.dayNumber - localParts(nowMs).dayNumber
  if (days === 0) return `hoje às ${when.time}`
  if (days === 1) return `amanhã às ${when.time}`
  return `${when.weekday}, ${when.date} às ${when.time}`
}
