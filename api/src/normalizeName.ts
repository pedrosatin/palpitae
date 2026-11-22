/**
 * Normalização de nome para comparação: sem acento, minúsculas e sem pontuação.
 * 'São Paulo' e 'Sao Paulo' viram a mesma chave.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
