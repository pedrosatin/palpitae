import { buildApiUrl } from '../config'
import { apiFetch } from './api'

/** Limite de grupos de destino por requisição, o mesmo da API. */
export const MAX_REPLICATE_TARGETS = 10

export type ReplicateResponse = {
  groups: { group_id: string; saved: number; replaced: number }[]
  skipped_groups: string[]
  locked_matches: string[]
  missing_matches: string[]
}

/**
 * Pede à API que copie para `targetGroupIds` os palpites já salvos em `sourceGroupId`
 * nos jogos `matchIds`. A API lê o placar do grupo de origem, então o front só diz
 * quais jogos e quais grupos. Erro da API vira exceção com a mensagem dela.
 */
export async function postReplicate(
  sourceGroupId: string,
  targetGroupIds: string[],
  matchIds: string[],
): Promise<ReplicateResponse> {
  const res = await apiFetch(buildApiUrl('/predictions/replicate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_group_id: sourceGroupId,
      target_group_ids: targetGroupIds,
      match_ids: matchIds,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as Partial<ReplicateResponse> & {
    error?: string
  }
  if (!res.ok) throw new Error(data.error ?? 'Erro ao aplicar nos outros grupos')
  return {
    groups: data.groups ?? [],
    skipped_groups: data.skipped_groups ?? [],
    locked_matches: data.locked_matches ?? [],
    missing_matches: data.missing_matches ?? [],
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

/**
 * Confirmação depois de aplicar nos outros grupos. O grupo atual já estava salvo,
 * então conta como um. Diz em quantos grupos o palpite ficou, onde ele trocou um
 * palpite diferente e o que ficou de fora.
 */
export function describeReplicate(
  result: ReplicateResponse,
  nameOf: (groupId: string) => string,
): string {
  const received = result.groups.filter((g) => g.saved > 0)
  const parts = [`Salvo em ${plural(1 + received.length, 'grupo', 'grupos')}.`]

  const replaced = received.filter((g) => g.replaced > 0)
  if (replaced.length > 0) {
    const where = replaced.map(
      (g) => `${nameOf(g.group_id)} (${plural(g.replaced, 'jogo', 'jogos')})`,
    )
    parts.push(`Palpite diferente substituído em ${joinNames(where)}.`)
  }
  if (result.locked_matches.length > 0) {
    const n = result.locked_matches.length
    parts.push(
      n === 1 ? '1 jogo já bloqueado ficou de fora.' : `${n} jogos já bloqueados ficaram de fora.`,
    )
  }
  if (result.skipped_groups.length > 0) {
    parts.push(`Não aplicado em ${joinNames(result.skipped_groups.map(nameOf))}.`)
  }
  return parts.join(' ')
}
