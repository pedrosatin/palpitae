import { describe, expect, it } from 'vitest'
import {
  buildRoundShareCardData,
  cardName,
  drawRoundShareCard,
  roundShareFileName,
  roundShareText,
} from './roundShareCard'
import type { RoundStanding } from './roundSummary'
import { LIME, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './shareCard'

function standing(display: string, points: number, position: number, isYou = false): RoundStanding {
  return { user_id: display, display, points, position, isYou, exact: 1, correct: 2, missed: 0 }
}

const standings = [
  standing('Ana Souza', 12, 1),
  standing('Bruno Lima', 9, 2),
  standing('Carla Dias', 7, 3),
  standing('ab***@gmail.com', 4, 4, true),
  standing('Davi Rocha', 1, 5),
]

const leaderInput = {
  standings: [standing('Ana Souza', 12, 1, true), standing('Bruno Lima', 9, 2)],
  self: { points: 12, exact: 1, correct: 2, missed: 0, position: 1 },
}

function build(overrides: Partial<Parameters<typeof buildRoundShareCardData>[0]> = {}) {
  return buildRoundShareCardData({
    groupName: 'Realidade do BR',
    roundLabel: 'Rodada 34',
    standings,
    self: { points: 4, exact: 1, correct: 2, missed: 0, position: 4 },
    postponed: 0,
    origin: 'https://palpitae.com.br',
    ...overrides,
  })
}

describe('buildRoundShareCardData', () => {
  it('mostra o top 3 só com o primeiro nome e acrescenta a sua linha', () => {
    const data = build()
    expect(data.standings.map((s) => [s.position, s.display, s.points])).toEqual([
      [1, 'Ana', 12],
      [2, 'Bruno', 9],
      [3, 'Carla', 7],
      [4, 'Você', 4],
    ])
    expect(data.total).toBe(5)
    expect(data.domain).toBe('palpitae.com.br')
  })

  it('não repete a sua linha quando você está no top 3', () => {
    const data = build({
      standings: [standing('Ana Souza', 12, 1, true), standing('Bruno Lima', 9, 2)],
      self: { points: 12, exact: 1, correct: 2, missed: 0, position: 1 },
    })
    expect(data.standings).toHaveLength(2)
    expect(data.standings[0].display).toBe('Você')
  })

  it('nunca leva e-mail de membro para a imagem', () => {
    const data = build({
      standings: [standing('ab***@gmail.com', 12, 1), ...standings.slice(1)],
    })
    expect(JSON.stringify(data)).not.toContain('@')
    expect(data.standings[0].display).toBe('Palpiteiro')
  })

  it('marca quem compartilha quando está entre os líderes', () => {
    expect(build(leaderInput).isRoundLeader).toBe(true)
  })

  it('marca quem compartilha também no empate', () => {
    const tied = build({
      standings: [standing('Ana Souza', 12, 1), standing('Bruno Lima', 12, 1, true)],
      self: { points: 12, exact: 1, correct: 2, missed: 0, position: 1 },
    })
    expect(tied.isRoundLeader).toBe(true)
  })

  it('não marca quem ficou fora da liderança', () => {
    expect(build().isRoundLeader).toBe(false)
  })

  it('não marca ninguém quando a rodada não teve pontos', () => {
    const data = build({
      standings: [standing('Ana Souza', 0, 1, true), standing('Bruno Lima', 0, 1)],
      self: { points: 0, exact: 0, correct: 0, missed: 2, position: 1 },
    })
    expect(data.isRoundLeader).toBe(false)
  })

  it('leva o aviso do jogo adiado', () => {
    expect(build({ postponed: 1 }).notice).toBe('1 jogo adiado ainda vale pontos')
    expect(build().notice).toBeNull()
  })
})

describe('textos do cartão', () => {
  it('cardName usa o primeiro nome', () => {
    expect(cardName('Ana Souza')).toBe('Ana')
    expect(cardName('x***@y.com')).toBe('Palpiteiro')
  })

  it('texto e nome de arquivo', () => {
    expect(roundShareText(build())).toBe(
      'Fiz 4 pontos na rodada 34 do bolão "Realidade do BR" no Palpitae. Fiquei em 4º de 5. palpitae.com.br',
    )
    expect(roundShareFileName('Rodada 34')).toBe('palpitae-rodada-34.png')
    expect(roundShareFileName('Rodada única')).toBe('palpitae-rodada-unica.png')
  })

  it('o texto de quem lidera menciona o título', () => {
    expect(roundShareText(build(leaderInput))).toBe(
      'Fiz 12 pontos na rodada 34 do bolão "Realidade do BR" no Palpitae. Fiquei em 1º de 2. Levei o título de rei da rodada. palpitae.com.br',
    )
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

describe('drawRoundShareCard', () => {
  it('desenha o título do líder em lime, entre o divisor do topo e o nome da rodada', () => {
    const { ctx, draws } = recordingContext()
    drawRoundShareCard(ctx, build(leaderInput))

    // O divisor fica em y 158 e o nome da rodada, em 34 px, tem a base em y 280. O título tem 40 px.
    const band = draws.filter((d) => d.y > 158 + 40 && d.y < 280 - 34)
    expect(band.map((d) => d.text).join('')).toBe('REI DA RODADA')
    expect(band.every((d) => d.color === LIME)).toBe(true)
  })

  it('não desenha o título para quem não lidera', () => {
    const { ctx, draws } = recordingContext()
    drawRoundShareCard(ctx, build())

    expect(draws.map((d) => d.text).join('')).not.toContain('REI DA RODADA')
  })

  it('desenha em 1080×1350 e escreve os pontos, sem e-mail', () => {
    const { ctx, draws } = recordingContext()
    drawRoundShareCard(ctx, build({ postponed: 1 }))
    const texts = draws.map((d) => d.text)
    expect(SHARE_CARD_WIDTH).toBe(1080)
    expect(SHARE_CARD_HEIGHT).toBe(1350)
    expect(texts).toContain('4')
    expect(texts).toContain('1 jogo adiado ainda vale pontos')
    expect(texts.join('')).not.toContain('@')
  })
})
