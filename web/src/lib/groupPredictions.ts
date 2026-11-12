import { buildApiUrl } from '../config'
import { apiFetch } from './api'
import { fetchCachedJson } from './api-cache'
import { isRecord, UNEXPECTED_RESPONSE } from './responseShape'

/**
 * `GET /predictions/group` com o cache em memória de 30 s. Uma resposta pesa cerca de
 * 350 KB num grupo grande, e a aba Grupo e o resumo da rodada leem a mesma entrada.
 * Quem salva palpite limpa o prefixo `groups:`, que cobre esta chave. Resposta sem as
 * listas `members` e `predictions` vira erro e não fica no cache.
 */
export function fetchGroupPredictions<T>(groupId: string): Promise<T> {
  return fetchCachedJson(
    `groups:predictions:${groupId}`,
    () =>
      apiFetch(buildApiUrl('/predictions/group', new URLSearchParams({ group_id: groupId }))).then(
        (res) => {
          if (!res.ok) throw new Error('Erro ao carregar palpites do grupo')
          return res.json().then((body: unknown) => {
            if (!isRecord(body) || !Array.isArray(body.members) || !Array.isArray(body.predictions))
              throw new Error(UNEXPECTED_RESPONSE)
            return body as T
          })
        },
      ),
    30_000,
  )
}
