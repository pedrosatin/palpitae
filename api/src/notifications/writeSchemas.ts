import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as v from 'valibot'
import type { MailjetEvent } from './mailjetEvents'

export const PREFERENCES_ROUND_REMINDERS_MSG = 'round_reminders (boolean) é obrigatório'

type Issue = StandardSchemaV1.Issue

/**
 * Corpo de `PATCH /notifications/preferences`:
 * `{ round_reminders: boolean }`. true → inscrito (NULL), false → opt-out.
 */
export const patchPreferencesSchema = v.object({
  round_reminders: v.boolean(),
})

export type PatchPreferencesBody = v.InferOutput<typeof patchPreferencesSchema>

/** Toda falha de schema desta rota responde `round_reminders (boolean) é obrigatório`. */
export function mapPatchPreferencesError(_data: unknown, _issues: readonly Issue[]): string {
  return PREFERENCES_ROUND_REMINDERS_MSG
}

/**
 * Payload do webhook Mailjet (Event API). Aceita lista ou objeto único (com
 * campos extras), embrulha o objeto em lista, descarta itens que não são objeto
 * e exige pelo menos um evento. Valores soltos no topo (string, número, null)
 * e lista vazia após o filtro falham; a rota trata a falha como 200 `ok`.
 */
export const mailjetPayloadSchema = v.pipe(
  v.union([v.array(v.unknown()), v.looseObject({})]),
  v.transform((payload): MailjetEvent[] => {
    if (Array.isArray(payload)) {
      return payload.filter(
        (item): item is MailjetEvent => item !== null && typeof item === 'object',
      )
    }
    return [payload as MailjetEvent]
  }),
  v.check((events) => events.length > 0),
)

export type MailjetPayloadBody = v.InferOutput<typeof mailjetPayloadSchema>
