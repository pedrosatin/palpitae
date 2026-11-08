import { describe, it, expect } from 'vitest'

// O vite.config libera só variables.css do esvaziamento de CSS nos testes.
const css = Object.values(
  import.meta.glob<string>('./variables.css', { query: '?raw', import: 'default', eager: true }),
)[0]

function token(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`Token ${name} não encontrado`)
  return match[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const surfaces = ['--color-bg', '--color-surface', '--color-surface-elevated']

describe('tokens de cor do texto', () => {
  it('fixa os valores do texto secundário e terciário', () => {
    expect(token('--color-text-secondary')).toBe('#b3b3b3')
    expect(token('--color-text-muted')).toBe('#8f8f8f')
  })

  it.each(['--color-text-primary', '--color-text-secondary', '--color-text-muted'])(
    '%s tem pelo menos 4,5:1 sobre todos os fundos',
    (text) => {
      for (const surface of surfaces) {
        expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it('mantém a hierarquia entre primário, secundário e terciário', () => {
    const bg = token('--color-bg')
    expect(contrast(token('--color-text-primary'), bg)).toBeGreaterThan(
      contrast(token('--color-text-secondary'), bg),
    )
    expect(contrast(token('--color-text-secondary'), bg)).toBeGreaterThan(
      contrast(token('--color-text-muted'), bg),
    )
  })

  it('o verde da marca serve de foco, com pelo menos 3:1 sobre todos os fundos', () => {
    for (const surface of surfaces) {
      expect(contrast(token('--color-primary'), token(surface))).toBeGreaterThanOrEqual(3)
    }
  })
})
