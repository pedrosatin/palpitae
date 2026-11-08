import { config } from '../config'
import { apiFetch } from './api'
import { fetchCachedJson } from './api-cache'

/**
 * `GET /predictions/group` com o cache em memória de 30 s. Uma resposta pesa cerca de
 * 350 KB num grupo grande, e a aba Grupo e o resumo da rodada leem a mesma entrada.
 * Quem salva palpite limpa o prefixo `groups:`, que cobre esta chave.
 */
export function fetchGroupPredictions<T>(groupId: string): Promise<T> {
  return fetchCachedJson(
    `groups:predictions:${groupId}`,
    () =>
      apiFetch(`${config.apiUrl}/predictions/group?group_id=${encodeURIComponent(groupId)}`).then(
        (res) => {
          if (!res.ok) throw new Error('Erro ao carregar palpites do grupo')
          return res.json() as Promise<T>
        },
      ),
    30_000,
  )
}
