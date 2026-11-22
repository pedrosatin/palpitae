const LENGTH_ERROR = 'Nome deve ter entre 2 e 30 caracteres'
const INVISIBLE_ERROR = 'Nome não pode ter caracteres invisíveis'

const ALLOWED_INVISIBLE_SEQUENCES =
  /(?<=[\p{L}\p{N}\p{P}\p{S}])[\u{FE0E}\u{FE0F}]|(?<=[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}])\u{200D}(?=\p{Extended_Pictographic})|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}/gu

/**
 * Controle (Cc); formatação (Cf: largura zero, ZWNJ, ZWJ, marcadores e
 * isoladores de direção, hífen discricionário); separadores de linha e
 * parágrafo; surrogate isolado (Cs); uso privado (Co); os demais ignoráveis por
 * padrão (preenchedores Hangul, seletores de variação, U+034F, U+17B4/17B5,
 * tags); e o braille em branco U+2800.
 */
const INVISIBLE_CHARACTER =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}\u{2800}]/u

/**
 * Regra do nome do grupo, a mesma na criação e na renomeação: texto em NFC, sem
 * espaços nas pontas, sem caracteres invisíveis e com 2 a 30 caracteres.
 */
export function parseGroupName(value: unknown): { name: string } | { error: string } {
  if (typeof value !== 'string') return { error: LENGTH_ERROR }
  const name = value.normalize('NFC').trim()
  if (INVISIBLE_CHARACTER.test(name.replace(ALLOWED_INVISIBLE_SEQUENCES, ''))) {
    return { error: INVISIBLE_ERROR }
  }
  if (name.length < 2 || name.length > 30) return { error: LENGTH_ERROR }
  return { name }
}
