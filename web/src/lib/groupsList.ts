import { buildApiUrl } from '../config'
import type { GroupWithStats } from '../components/GroupCard'
import { apiFetch } from './api'
import { fetchCachedJson } from './api-cache'

export type GroupsListResponse = {
  groups: GroupWithStats[]
  matched_invite_group_id: string | null
}

/**
 * `GET /groups` com o cache em memória de 30 s. O painel e a importação de
 * palpites leem a mesma entrada, então abrir um grupo pelo painel não repete a
 * lista. Quem muda grupo ou palpite limpa o prefixo `groups:`. Sem `userId`, a
 * busca vai direto à API.
 */
export function fetchGroupsList(
  userId: string | undefined,
  inviteCode?: string,
): Promise<GroupsListResponse> {
  const load = () => {
    const searchParams = new URLSearchParams()
    if (inviteCode) searchParams.set('invite_code', inviteCode)
    return apiFetch(buildApiUrl('/groups', searchParams), { cache: 'no-store' }).then((res) => {
      if (!res.ok) throw new Error('Falha ao carregar grupos')
      return res.json() as Promise<GroupsListResponse>
    })
  }
  if (!userId) return load()
  return fetchCachedJson(`groups:list:${userId}:${inviteCode ?? 'default'}`, load, 30_000)
}
