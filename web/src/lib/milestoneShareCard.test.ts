import { describe, expect, it } from 'vitest'
import {
  buildMilestoneShareCardData,
  drawMilestoneShareCard,
  layoutFooterLink,
  milestoneShareFileName,
  milestoneShareText,
  MILESTONE_FOOTER_MAX_WIDTH,
  splitFooterLink,
} from './milestoneShareCard'
import { FONT, LIME, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './shareCardParts'

/** Link público completo: domínio + /grupo/ + 32 hex. */
const PUBLIC_GROUP_LINK =
  'https://palpitae.com.br/grupo/abcdef0123456789abcdef0123456789'
const PUBLIC_GROUP_LABEL = 'palpitae.com.br/grupo/abcdef0123456789abcdef0123456789'

/**
 * Largura proporcional realista para sans-serif bold: ~0.62 × tamanho por
 * caractere latino típico. O link público de 32 hex mede ~1.020 px em 36 px,
 * acima dos 920 px úteis do rodapé.
 */
function proportionalWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62
}

function build(
  crossed: Array<5 | 15 | 30> = [5],
  exactHits = 5,
  groupLink: string | null = null,
) {
  return buildMilestoneShareCardData({
    groupName: 'Realidade do BR',
    crossed,
    exactHits,
    origin: 'https://palpitae.com.br',
    groupLink,
  })
}

describe('buildMilestoneShareCardData', () => {
  it('usa o maior limiar cruzado como herói', () => {
    const data = build([5, 15], 16)
    expect(data).toMatchObject({
      milestone: 15,
      crossed: [5, 15],
      exactHits: 16,
      domain: 'palpitae.com.br',
      groupLink: null,
    })
  })

  it('devolve null sem cruzamento', () => {
    expect(
      buildMilestoneShareCardData({
        groupName: 'X',
        crossed: [],
        exactHits: 4,
        origin: 'https://palpitae.com.br',
      }),
    ).toBeNull()
  })
})

describe('textos do cartão de marco', () => {
  it('inclui o link do grupo em primeira pessoa quando informado', () => {
    const data = build([5], 5, 'https://palpitae.com.br/convite/AAAA-BBBB')!
    expect(milestoneShareText(data)).toBe(
      'Cruzei o marco de 5 placares exatos neste grupo no bolão "Realidade do BR" no Palpitae. Já são 5 placares exatos. Entra com a gente: https://palpitae.com.br/convite/AAAA-BBBB',
    )
  })

  it('cai no domínio quando não há link', () => {
    const data = build([15], 15)!
    expect(milestoneShareText(data)).toContain('palpitae.com.br')
    expect(milestoneShareFileName(15)).toBe('palpitae-marco-15-exatos.png')
  })
})

function recordingContext() {
  const draws: { text: string; y: number; color: unknown }[] = []
  const state: Record<string, unknown> = {
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillText: (text: string, _x: number, y: number) =>
      draws.push({ text, y, color: state.fillStyle }),
  }
  const ctx = new Proxy(state, {
    get: (target, prop: string) => target[prop] ?? (() => undefined),
    set: (target, prop: string, value) => {
      target[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, draws }
}

describe('drawMilestoneShareCard', () => {
  it('pinta o limiar em destaque', () => {
    const { ctx, draws } = recordingContext()
    Object.assign(ctx, { canvas: { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT } })
    drawMilestoneShareCard(ctx, build([5], 5)!)
    expect(draws.some((d) => d.text === '5' && d.color === LIME)).toBe(true)
    expect(draws.some((d) => d.text === 'MARCO ATINGIDO')).toBe(true)
  })

  it('grava o link do grupo no rodapé da imagem', () => {
    const { ctx, draws } = recordingContext()
    Object.assign(ctx, {
      canvas: { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT },
      measureText: (t: string) => ({ width: proportionalWidth(t, 36) }),
    })
    drawMilestoneShareCard(
      ctx,
      build([5], 5, 'https://palpitae.com.br/convite/AAAA-BBBB')!,
    )
    expect(draws.some((d) => d.text === 'palpitae.com.br/convite/AAAA-BBBB')).toBe(true)
  })

  it('desenha o link público de 32 hex completo, sem perder caracteres', () => {
    const { ctx, draws } = recordingContext()
    let currentSize = 36
    Object.assign(ctx, {
      canvas: { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT },
      measureText: (t: string) => ({ width: proportionalWidth(t, currentSize) }),
    })
    Object.defineProperty(ctx, 'font', {
      set(value: string) {
        const match = /(\d+)px/.exec(value)
        if (match) currentSize = Number(match[1])
      },
      get() {
        return `700 ${currentSize}px ${FONT}`
      },
    })
    drawMilestoneShareCard(ctx, build([5], 5, PUBLIC_GROUP_LINK)!)

    const drawn = draws.map((d) => d.text)
    expect(drawn).toContain('palpitae.com.br/grupo/')
    expect(drawn).toContain('abcdef0123456789abcdef0123456789')
    expect(drawn.every((t) => !t.includes('…'))).toBe(true)
  })
})

describe('layoutFooterLink', () => {
  it('parte o link público em duas linhas que cabem na largura útil', () => {
    expect(proportionalWidth(PUBLIC_GROUP_LABEL, 36)).toBeGreaterThan(MILESTONE_FOOTER_MAX_WIDTH)

    const layout = layoutFooterLink(proportionalWidth, PUBLIC_GROUP_LABEL)
    expect(layout.lines.length).toBe(2)
    expect(layout.lines.join('')).toBe(PUBLIC_GROUP_LABEL)
    for (const line of layout.lines) {
      expect(proportionalWidth(line, layout.fontSize)).toBeLessThanOrEqual(
        MILESTONE_FOOTER_MAX_WIDTH,
      )
    }
    expect(layout.fontSize).toBeGreaterThanOrEqual(22)
    expect(layout.fontSize).toBeLessThanOrEqual(36)
  })

  it('mantém uma linha quando o texto já cabe', () => {
    const layout = layoutFooterLink(proportionalWidth, 'palpitae.com.br')
    expect(layout).toEqual({ fontSize: 36, lines: ['palpitae.com.br'] })
  })

  it('prefere quebrar depois de uma barra', () => {
    expect(splitFooterLink(PUBLIC_GROUP_LABEL)).toEqual([
      'palpitae.com.br/grupo/',
      'abcdef0123456789abcdef0123456789',
    ])
  })
})
