const LENGTH_ERROR = 'Nome deve ter entre 2 e 30 caracteres'
const INVISIBLE_ERROR = 'Nome não pode ter caracteres invisíveis'

/**
 * Usos legítimos de caractere de formatação num nome: a junção (U+200D) entre
 * dois emoji, como em 👨‍👩‍👧, e a sequência de tags da bandeira de subdivisão,
 * como em 🏴󠁧󠁢󠁥󠁮󠁧󠁿. Saem do texto antes da busca por caracteres invisíveis.
 */
const EMOJI_FORMAT_SEQUENCES =
  /(?<=[\p{Extended_Pictographic}\p{Emoji_Modifier}️])‍(?=\p{Extended_Pictographic})|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}/gu

/**
 * Controle (Cc), formatação (Cf: largura zero, marcadores e isoladores de
 * direção, hífen discricionário) e separadores de linha e parágrafo.
 */
const INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/**
 * Regra do nome do grupo, a mesma na criação e na renomeação: texto em NFC, sem
 * espaços nas pontas, sem caracteres invisíveis e com 2 a 30 caracteres.
 */
export function parseGroupName(value: unknown): { name: string } | { error: string } {
  if (typeof value !== 'string') return { error: LENGTH_ERROR }
  const name = value.normalize('NFC').trim()
  if (INVISIBLE_CHARACTER.test(name.replace(EMOJI_FORMAT_SEQUENCES, ''))) {
    return { error: INVISIBLE_ERROR }
  }
  if (name.length < 2 || name.length > 30) return { error: LENGTH_ERROR }
  return { name }
}
