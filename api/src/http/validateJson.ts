import { sValidator } from '@hono/standard-validator'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Context, Env, Input, MiddlewareHandler } from 'hono'
import { INVALID_BODY, readJsonObject } from './jsonBody'

/**
 * Converte a falha do schema na mensagem `{ error }` da rota.
 * Recebe as issues do Standard Schema e o corpo lido, que é objeto no modo
 * `object` e qualquer valor JSON no modo `value`.
 */
export type JsonErrorMapper = (data: unknown, issues: readonly StandardSchemaV1.Issue[]) => string

type JsonValidated<Schema extends StandardSchemaV1> = {
  in: { json: StandardSchemaV1.InferInput<Schema> }
  out: { json: StandardSchemaV1.InferOutput<Schema> }
}

/** Mesma regex que o validator JSON do Hono usa para aceitar o Content-Type. */
const JSON_CONTENT_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i

export type ValidateJsonOptions = {
  /**
   * Mensagem de 400 quando a leitura do corpo falha no modo escolhido.
   * Padrão: `Body JSON inválido`.
   */
  invalidBodyError?: string
  /**
   * `object` (padrão): só objeto JSON segue para o schema; `null`, lista, valor
   * solto ou JSON malformado respondem com `invalidBodyError`.
   * `value`: qualquer JSON parseado segue para o schema; só malformado responde com
   * `invalidBodyError`. Use quando lista, número ou `null` devem chegar ao
   * schema e receber a mensagem do mapper.
   */
  body?: 'object' | 'value'
}

/**
 * Valida o corpo JSON com `@hono/standard-validator` e um schema Standard Schema
 * (Valibot). No modo `object`, corpo malformado, `null`, lista ou valor solto
 * responde 400 com `invalidBodyError`, que por padrão é `Body JSON inválido`.
 * O Content-Type não restringe a leitura: JSON válido sem cabeçalho ou com
 * outro tipo segue para o schema. Falha de schema responde 400 com a mensagem
 * do mapper.
 *
 * O valor validado fica em `c.req.valid('json')` para o handler.
 */
export function validateJson<Schema extends StandardSchemaV1, E extends Env = Env>(
  schema: Schema,
  mapError: JsonErrorMapper,
  options?: ValidateJsonOptions,
): MiddlewareHandler<E, string, JsonValidated<Schema> & Input> {
  const invalidBodyError = options?.invalidBodyError ?? INVALID_BODY
  const bodyMode = options?.body ?? 'object'

  const validate = sValidator('json', schema, (result, c: Context<E, string>) => {
    if (!result.success) {
      return c.json({ error: mapError(result.data, result.error) }, 400)
    }
  })

  return async (c, next) => {
    let body: unknown
    if (bodyMode === 'object') {
      body = await readJsonObject(c)
      if (!body) return c.json({ error: invalidBodyError }, 400)
    } else {
      const sentinel = Symbol('invalid-json')
      const parsed: unknown = await c.req.json().catch(() => sentinel)
      if (parsed === sentinel) return c.json({ error: invalidBodyError }, 400)
      body = parsed
    }
    ensureJsonContentTypeForValidator(c, body)
    return validate(c, next)
  }
}

/**
 * Garante Content-Type JSON no Request atual para o gate do sValidator.
 * Troca `c.req.raw` por uma cópia com Content-Type JSON e o corpo serializado.
 * A cópia não leva `cf` nem `signal`; nenhum código da API lê esses campos.
 */
function ensureJsonContentTypeForValidator<E extends Env = Env>(
  c: Context<E>,
  body: unknown,
): void {
  const contentType = c.req.header('Content-Type')
  if (contentType && JSON_CONTENT_TYPE.test(contentType)) return

  const headers = new Headers(c.req.raw.headers)
  headers.set('Content-Type', 'application/json')
  c.req.raw = new Request(c.req.url, {
    method: c.req.raw.method,
    headers,
    body: JSON.stringify(body),
  })
  // Limpa o cache do corpo consumido para o sValidator ler o Request novo.
  c.req.bodyCache = {}
}
