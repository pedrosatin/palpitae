import { sValidator } from '@hono/standard-validator'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Input, MiddlewareHandler } from 'hono'
import type { AppContext } from '../types'
import { INVALID_BODY, readJsonObject } from './jsonBody'

/**
 * Converte a falha do schema na mensagem `{ error }` que a rota já devolveia.
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

/**
 * Valida o corpo JSON com `@hono/standard-validator` e um schema Standard Schema
 * (Valibot). Corpo malformado, `null`, lista ou valor solto responde 400 com
 * `Body JSON inválido`, como o `readJsonObject`. Falha de schema responde 400
 * com a mensagem do mapper, para o contrato atual da rota.
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
    // sValidator tipa o Env genérico; o corpo e o contrato HTTP já foram conferidos acima.
    return validate(c as never, next)
  }
}
