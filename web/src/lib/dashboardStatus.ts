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
 * Campos do `GET /groups` usados aqui. Opcionais porque uma resposta anterior
 * ao campo pode ficar no cache por alguns segundos depois do deploy.
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

/** Texto da linha de status do card. */
export function groupRoundStatusText(status: GroupRoundStatus, nowMs: number): string {
  switch (status.kind) {
    case 'pending':
      return status.deadline
        ? `${status.count} sem palpite · fecha ${formatShortWhen(status.deadline, nowMs)}`
        : `${status.count} sem palpite`
    case 'live':
      return status.count === 1 ? '1 jogo ao vivo' : `${status.count} jogos ao vivo`
    case 'complete': {
      const done = status.roundLabel
        ? `${status.roundLabel} ${completeWord(status.roundLabel)}`
        : 'Tudo palpitado'
      return `${done} ✓ · próximo jogo ${formatShortWhen(status.nextMatchAt, nowMs)}`
    }
    case 'empty':
      return 'Sem jogos marcados'
  }
}

/**
 * Concordância de "completa" com o `roundLabel` da API. Exemplos:
 * "Rodada 35 completa", "Semifinais completas", "Playoffs completos".
 */
export function completeWord(roundLabel: string): string {
  if (/^(Oitavas|Quartas|Semifinais)\b/.test(roundLabel)) return 'completas'
  if (/^Playoffs\b/.test(roundLabel)) return 'completos'
  if (/^(Rebaixamento|Terceiro lugar)\b/.test(roundLabel)) return 'completo'
  return 'completa'
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
 * Ordem do painel: grupos com jogo sem palpite primeiro, pelo fechamento mais
 * próximo; depois os com jogo ao vivo; depois os demais pela data do próximo
 * jogo; por último os sem jogo marcado. Empate mantém a ordem da API.
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
  | { kind: 'clear'; until: string }

/**
 * Faixa do topo do painel, a partir dos grupos em andamento.
 *
 * Com pendência, aponta o grupo mais urgente pela mesma ordem dos cards. O total
 * soma os palpites que faltam em cada grupo, então o mesmo jogo em dois grupos
 * conta duas vezes.
 *
 * Sem pendência, diz até quando está tudo palpitado. A data é o fim da rodada
 * padrão que termina primeiro. Depois dele a rodada seguinte abre e traz
 * pendências novas. Sem rodada aberta em nenhum grupo, não há faixa.
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

  const ends = groups
    .map((group) => group.round_ends_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return ends.length > 0 ? { kind: 'clear', until: ends[0] } : null
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

/** Horário com data para a faixa: "hoje às 18:30", "amanhã às 18:30", "sex, 14/11 às 18:30". */
export function formatLongWhen(iso: string, nowMs: number): string {
  const when = localParts(Date.parse(iso))
  const days = when.dayNumber - localParts(nowMs).dayNumber
  if (days === 0) return `hoje às ${when.time}`
  if (days === 1) return `amanhã às ${when.time}`
  return `${when.weekday}, ${when.date} às ${when.time}`
}

/** Dia com semana: "sex, 14/11". */
export function formatDay(iso: string): string {
  const when = localParts(Date.parse(iso))
  return `${when.weekday}, ${when.date}`
}
