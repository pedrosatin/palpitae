/**
 * Checagem leve das respostas 200 da API, no estilo de `parseInvitePreview`.
 *
 * Não valida o contrato inteiro: confere só os campos que a tela usa sem
 * proteção. Resposta fora do formato vira erro com `UNEXPECTED_RESPONSE`, que a
 * aba mostra no lugar de quebrar no render ou exibir a mensagem de um TypeError.
 */

/** Aviso para resposta da API que chegou com sucesso mas fora do formato esperado. */
export const UNEXPECTED_RESPONSE = 'Resposta inesperada do servidor. Tente novamente.'

type Shape = Record<string, 'string' | 'number' | 'boolean'>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Verdadeiro quando `value` é objeto e cada campo de `shape` tem o tipo indicado. */
export function hasShape(value: unknown, shape: Shape): value is Record<string, unknown> {
  return isRecord(value) && Object.entries(shape).every(([key, type]) => typeof value[key] === type)
}

/** Lista em que todo item tem o formato de `shape`. */
export function isListOf(value: unknown, shape: Shape): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => hasShape(item, shape))
}
