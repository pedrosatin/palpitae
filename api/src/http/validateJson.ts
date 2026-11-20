import { sValidator } from '@hono/standard-validator'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Context, Input, MiddlewareHandler } from 'hono'
import type { AppContext } from '../types'
import { INVALID_BODY, readJsonObject } from './jsonBody'

/**
 * Converte a falha do schema na mensagem `{ error }` da rota.
 * Recebe o corpo bruto (já objeto) e as issues do Standard Schema.
 */
export type JsonErrorMapper = (
  data: unknown,
  issues: readonly StandardSchemaV1.Issue[],
) => string

type JsonValidated<Schema extends StandardSchemaV1> = {
  in: { json: StandardSchemaV1.InferInput<Schema> }
  out: { json: StandardSchemaV1.InferOutput<Schema> }
}

/** Mesma regex que o validator JSON do Hono usa para aceitar o Content-Type. */
const JSON_CONTENT_TYPE =
  /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i

/**
 * Valida o corpo JSON com `@hono/standard-validator` e um schema Standard Schema
 * (Valibot). Corpo malformado, `null`, lista ou valor solto responde 400 com
 * `Body JSON inválido`, como o `readJsonObject`. O Content-Type não restringe a
 * leitura: JSON válido sem cabeçalho ou com outro tipo segue para o schema. Falha de schema responde 400 com a mensagem do mapper.
 *
 * O valor validado fica em `c.req.valid('json')` para o handler.
 */
export function validateJson<Schema extends StandardSchemaV1>(
  schema: Schema,
  mapError: JsonErrorMapper,
): MiddlewareHandler<AppContext, string, JsonValidated<Schema> & Input> {
  const validate = sValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: mapError(result.data, result.error) }, 400)
    }
  })

  return async (c, next) => {
    const body = await readJsonObject(c)
    if (!body) return c.json({ error: INVALID_BODY }, 400)
    // O validator JSON do Hono ignora o corpo e valida `{}` quando o Content-Type
    // falta ou não é JSON. Por isso o Request é recriado com `application/json`
    // e o corpo já lido por `readJsonObject`.
    ensureJsonContentTypeForValidator(c, body)
    // O cast contorna o Env genérico do sValidator. `readJsonObject` já garantiu
    // que o corpo é um objeto JSON.
    return validate(c as never, next)
  }
}

/**
 * Garante Content-Type JSON no Request atual para o gate do sValidator.
 * Troca `c.req.raw` por uma cópia com Content-Type JSON e o corpo serializado.
 * A cópia não leva `cf` nem `signal`; nenhum código da API lê esses campos.
 */
function ensureJsonContentTypeForValidator(
  c: Context<AppContext>,
  body: object,
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
