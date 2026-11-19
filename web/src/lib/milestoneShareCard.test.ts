import { describe, expect, it } from 'vitest'
import {
  buildMilestoneShareCardData,
  drawMilestoneShareCard,
  milestoneShareFileName,
  milestoneShareText,
} from './milestoneShareCard'
import { LIME, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './shareCardParts'

function build(crossed: Array<5 | 15 | 30> = [5], exactHits = 5) {
  return buildMilestoneShareCardData({
    groupName: 'Realidade do BR',
    crossed,
    exactHits,
    origin: 'https://palpitae.com.br',
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
  it('inclui o link do grupo quando informado', () => {
    const data = build([5], 5)!
    expect(milestoneShareText(data, 'https://palpitae.com.br/convite/AAAA-BBBB')).toBe(
      'Você cruzou o marco de 5 placares exatos neste grupo no bolão "Realidade do BR" no Palpitae. Já são 5 placares exatos. Entra com a gente: https://palpitae.com.br/convite/AAAA-BBBB',
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
})
