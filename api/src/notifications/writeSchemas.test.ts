import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import {
  mailjetPayloadSchema,
  mapPatchPreferencesError,
  patchPreferencesSchema,
  PREFERENCES_ROUND_REMINDERS_MSG,
} from './writeSchemas'

function issuesOf(
  schema: StandardSchemaV1,
  data: unknown,
): readonly StandardSchemaV1.Issue[] {
  const result = schema['~standard'].validate(data) as {
    issues?: readonly StandardSchemaV1.Issue[]
  }
  return result.issues ?? []
}

describe('mapPatchPreferencesError', () => {
  it('sempre responde a mensagem de round_reminders', () => {
    expect(mapPatchPreferencesError({}, issuesOf(patchPreferencesSchema, {}))).toBe(
      PREFERENCES_ROUND_REMINDERS_MSG,
    )
    expect(
      mapPatchPreferencesError(
        { round_reminders: 'x' },
        issuesOf(patchPreferencesSchema, { round_reminders: 'x' }),
      ),
    ).toBe(PREFERENCES_ROUND_REMINDERS_MSG)
  })
})

describe('mailjetPayloadSchema', () => {
  it('normaliza objeto único e lista, filtrando itens que não são objeto', () => {
    expect(mailjetPayloadSchema['~standard'].validate({ event: 'unsub' })).toMatchObject({
      value: [{ event: 'unsub' }],
    })
    expect(
      mailjetPayloadSchema['~standard'].validate({
        event: 'unsub',
        extra: 1,
      }),
    ).toMatchObject({ value: [{ event: 'unsub', extra: 1 }] })
    expect(
      mailjetPayloadSchema['~standard'].validate([
        { event: 'unsub' },
        { event: 'spam' },
      ]),
    ).toMatchObject({
      value: [{ event: 'unsub' }, { event: 'spam' }],
    })
    expect(
      mailjetPayloadSchema['~standard'].validate([
        'lixo',
        { event: 'spam', foo: 'bar' },
      ]),
    ).toMatchObject({ value: [{ event: 'spam', foo: 'bar' }] })
  })

  it('recusa valor solto, null e lista sem objetos', () => {
    for (const data of [null, 42, 'x', true, [], ['lixo', 1]]) {
      expect(issuesOf(mailjetPayloadSchema, data).length).toBeGreaterThan(0)
    }
  })
})
