import { buildApiUrl } from '../config'

/**
 * Dados do convite que um visitante sem conta pode ver. Vêm de
 * `GET /public/invites/:code`, direto ou embutidos pela Pages Function de
 * `/convite/:code` em `data-convite` no `#root`.
 */
export interface InvitePreview {
  groupName: string
  competitionName: string | null
  memberCount: number
  adminName: string | null
  pointsExact: number | null
  pointsWinner: number | null
}

export type InviteLookup =
  | { status: 'ready'; preview: InvitePreview }
  | { status: 'invalid' }
  | { status: 'unavailable' }

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function points(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Lê `{ invite: {...} }` no formato da API. Corpo fora do formato devolve null. */
export function parseInvitePreview(body: unknown): InvitePreview | null {
  const invite = (body as { invite?: Record<string, unknown> } | null)?.invite
  const groupName = optionalText(invite?.group_name)
  if (!invite || !groupName) return null
  const count = Number(invite.member_count)
  return {
    groupName,
    competitionName: optionalText(invite.competition_name),
    memberCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    adminName: optionalText(invite.admin_name),
    pointsExact: points(invite.points_exact),
    pointsWinner: points(invite.points_winner),
  }
}

/** Dados que a Pages Function embutiu no HTML, quando são deste código. */
export function readEmbeddedInvite(code: string): InvitePreview | null {
  const raw = document.getElementById('root')?.dataset.convite
  if (!raw) return null
  try {
    const data = JSON.parse(decodeURIComponent(raw)) as { code?: unknown }
    return data.code === code ? parseInvitePreview(data) : null
  } catch {
    return null
  }
}

/** Tempo máximo da consulta, para a tela não ficar em "Carregando" se a API travar. */
const LOOKUP_TIMEOUT_MS = 5000

/**
 * Busca o convite na API. Só 404 significa convite inválido. Limite de
 * requisições, erro do servidor e falha de rede viram `unavailable`, porque o
 * código ainda pode valer.
 */
export async function lookupInvite(code: string): Promise<InviteLookup> {
  try {
    // Fetch direto, porque a rota é pública e não há sessão para o apiFetch monitorar.
    const res = await fetch(buildApiUrl(`/public/invites/${encodeURIComponent(code)}`), {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (res.status === 404) return { status: 'invalid' }
    if (!res.ok) return { status: 'unavailable' }
    const preview = parseInvitePreview(await res.json())
    return preview ? { status: 'ready', preview } : { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}

function pointsLabel(value: number): string {
  return value === 1 ? '1 ponto' : `${value} pontos`
}

/** Regra de pontuação em uma linha. Null quando não há regra para mostrar. */
export function describeScoring(exact: number | null, winner: number | null): string | null {
  if (exact === null || winner === null) return null
  if (exact > 0 && winner > 0)
    return `${pointsLabel(exact)} no placar exato, ${winner} no resultado`
  if (exact > 0) return `${pointsLabel(exact)} só no placar exato`
  if (winner > 0) return `${pointsLabel(winner)} por acertar o vencedor`
  return null
}
