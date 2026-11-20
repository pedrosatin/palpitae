import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as v from 'valibot'

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

/** Qualquer falha de schema desta rota responde a mesma mensagem da base. */
export function mapPatchPreferencesError(_data: unknown, _issues: readonly Issue[]): string {
  return PREFERENCES_ROUND_REMINDERS_MSG
}

/**
 * Payload do webhook Mailjet (Event API). Aceita um objeto ou uma lista, e
 * preserva campos extras que o provedor manda. Itens soltos na lista passam;
 * `normalizeMailjetEvents` descarta o que não for objeto. Valores soltos no
 * topo (string, número, null) falham; a rota trata a falha como 200 `ok`.
 */
export const mailjetPayloadSchema = v.union([
  v.array(v.unknown()),
  v.looseObject({}),
])

export type MailjetPayloadBody = v.InferOutput<typeof mailjetPayloadSchema>
