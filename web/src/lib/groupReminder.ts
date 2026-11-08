import type { Match } from '../components/MatchCard'
import { formatClosingDate } from './matchTime'

export interface GroupMember {
  user_id: string
  display: string
}

/** Id do jogo aberto para os ids de quem já palpitou. É o `open_pickers` da API. */
export type OpenPickers = Record<string, string[]>

export interface RoundReminder {
  /** Quem não palpitou algum jogo aberto com data, na ordem da lista de membros. */
  missing: GroupMember[]
  /** Início do primeiro jogo em que falta alguém. `null` quando todo mundo palpitou. */
  deadline: string | null
}

/** Membros citados na mensagem do WhatsApp. Acima disso vira "e mais N". */
const MESSAGE_MAX_NAMES = 5
/** Limite do texto com o link, para caber em uma tela de conversa. */
const MESSAGE_MAX_CHARS = 280
/** Membros citados no resumo da rodada, para o texto não empurrar os cards. */
const SUMMARY_MAX_NAMES = 10

/**
 * Situação da rodada para o lembrete. Olha os jogos abertos com data marcada. O jogo
 * adiado fica fora, porque guarda o horário original e não tem prazo a citar. Sem
 * nenhum jogo assim, devolve `null` e a aba não mostra resumo.
 */
export function roundReminder(
  openMatches: Match[],
  members: GroupMember[],
  pickers: OpenPickers,
): RoundReminder | null {
  const dated = openMatches.filter((m) => !m.postponed)
  if (dated.length === 0) return null

  const missingIds = new Set<string>()
  let deadline: string | null = null
  for (const match of dated) {
    const picked = new Set(pickers[match.id])
    const absent = members.filter((m) => !picked.has(m.user_id))
    if (absent.length === 0) continue
    for (const member of absent) missingIds.add(member.user_id)
    if (!deadline || Date.parse(match.start_time) < Date.parse(deadline)) {
      deadline = match.start_time
    }
  }
  return { missing: members.filter((m) => missingIds.has(m.user_id)), deadline }
}

/** Lista como `Ana, Bruno e Carla`. O que passar de `limit` vira `e mais N`. */
export function joinNames(names: string[], limit = names.length): string {
  const shown = names.slice(0, limit)
  const rest = names.length - shown.length
  if (rest > 0) return `${shown.join(', ')} e mais ${rest}`
  if (shown.length <= 1) return shown.join('')
  return `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}`
}

/** Linha do resumo da rodada. Quem está vendo aparece como "você", no fim da lista. */
export function missingLabel(missing: GroupMember[], selfUserId: string): string {
  const others = missing.filter((m) => m.user_id !== selfUserId).map((m) => m.display)
  if (others.length === 0) return 'Só falta você palpitar'
  if (others.length === missing.length) {
    return `${others.length === 1 ? 'Falta' : 'Faltam'} palpitar: ${joinNames(others, SUMMARY_MAX_NAMES)}`
  }
  // A vaga de "você" é reservada, para ele nunca cair dentro do "e mais N".
  const shown = others.slice(0, SUMMARY_MAX_NAMES - 1)
  const rest = others.length - shown.length
  const text =
    rest > 0
      ? `${[...shown, 'você'].join(', ')} e mais ${rest}`
      : joinNames([...shown, 'você'])
  return `${shown.length === 0 ? 'Falta' : 'Faltam'} palpitar: ${text}`
}

/** Contagem do card, como `4 de 6 palpitaram`. */
export function pickersCountLabel(picked: number, total: number): string {
  return `${picked} de ${total} ${picked === 1 ? 'palpitou' : 'palpitaram'}`
}

/** Iniciais do círculo. Usa a primeira e a última palavra, ou as duas primeiras letras. */
export function memberInitials(display: string): string {
  const words = display.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0])
  const second = words.length > 1 ? Array.from(words[words.length - 1])[0] : first[1]
  return `${first[0]}${second ?? ''}`.toUpperCase()
}

/** E-mail mascarado que a API usa quando o membro não tem apelido nem nome, como `pe***@gmail.com`. */
const MASKED_EMAIL_RE = /^.{1,2}\*\*\*@\S+$/

/** Primeiro nome de cada membro. Quem divide o primeiro nome com outro fica com o nome inteiro. */
function shortNames(rawDisplays: string[]): string[] {
  const displays = rawDisplays.map((display) =>
    MASKED_EMAIL_RE.test(display.trim()) ? 'Palpiteiro' : display,
  )
  const first = displays.map((display) => display.trim().split(/\s+/)[0])
  return first.map((name, index) =>
    first.indexOf(name) === first.lastIndexOf(name) ? name : displays[index].trim(),
  )
}

/**
 * Texto do lembrete, sem o link. O WhatsApp e o menu nativo recebem o link à parte.
 * Corta nomes até o texto com o link caber em `MESSAGE_MAX_CHARS`.
 */
export function buildReminderMessage({
  roundLabel,
  groupName,
  missing,
  deadline,
  link,
}: {
  roundLabel: string
  groupName: string
  /** Nomes de exibição de quem falta palpitar. */
  missing: string[]
  /** Início do primeiro jogo em que falta alguém. */
  deadline: string
  link: string
}): string {
  const names = shortNames(missing)
  const verb = names.length === 1 ? 'ainda não palpitou' : 'ainda não palpitaram'
  const compose = (shown: number) =>
    `${roundLabel} do bolão "${groupName}". ${joinNames(names, shown)} ${verb}. ` +
    `O próximo prazo é ${formatClosingDate(deadline)}.`

  let shown = Math.min(names.length, MESSAGE_MAX_NAMES)
  while (shown > 1 && `${compose(shown)} ${link}`.length > MESSAGE_MAX_CHARS) shown -= 1
  return compose(shown)
}
