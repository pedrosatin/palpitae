import type { MiddlewareHandler } from 'hono'
import type { AppContext } from '../types'

/** Cache-Control padrão da API: nenhum cache guarda a resposta, nem o do navegador. */
export const DEFAULT_CACHE_CONTROL = 'private, no-store'

/**
 * Dá `private, no-store` a toda resposta que sair sem `Cache-Control` próprio. A
 * API devolve dado de conta quase em toda rota, e um cache que guardasse uma
 * dessas respostas a serviria a outro usuário. As rotas que podem ser guardadas
 * (`/matches` e `/public/*`) definem o cabeçalho delas e passam intactas.
 *
 * Roda por fora de todos os outros middlewares, então também cobre o que eles
 * respondem sem chegar à rota (CORS, limite de corpo, quota) e o 404 e o 500 dos
 * handlers de erro.
 */
export const defaultCacheControl: MiddlewareHandler<AppContext> = async (c, next) => {
  await next()
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', DEFAULT_CACHE_CONTROL)
}
