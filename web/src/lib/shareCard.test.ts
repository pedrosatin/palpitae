import { describe, it, expect, vi } from 'vitest'
import {
  buildShareCardData,
  drawShareCard,
  SHARE_CARD_WIDTH,
  SHARE_CARD_HEIGHT,
  type ShareCardData,
} from './shareCard'
import type { GroupWithStats } from '../components/GroupCard'

const base: GroupWithStats = {
  id: 'g1',
  name: 'Meu Grupo',
  is_admin: false,
  competition_id: 'comp-1',
  competition_name: 'Copa 2026',
  competition_status: 'finished',
  created_at: '2026-01-01T00:00:00Z',
  member_count: 8,
  user_position: 5,
  user_points: 42,
  podium: [
    { position: 1, display: 'João', points: 152, is_you: false },
    { position: 2, display: 'Ana', points: 140, is_you: false },
    { position: 3, display: 'Rui', points: 131, is_you: false },
  ],
}

describe('Constants', () => {
  it('exports correct SHARE_CARD_WIDTH and SHARE_CARD_HEIGHT', () => {
    expect(SHARE_CARD_WIDTH).toBe(1080)
    expect(SHARE_CARD_HEIGHT).toBe(1350)
  })
})

describe('buildShareCardData', () => {
  it('maps competition, position and total from the group', () => {
    const data = buildShareCardData(base, 'https://palpitae.app')
    expect(data.competition).toBe('Copa 2026')
    expect(data.position).toBe(5)
    expect(data.total).toBe(8)
    expect(data.isChampion).toBe(false)
  })

  it('appends the user own row when they finished outside the podium', () => {
    const data = buildShareCardData(base, 'https://palpitae.app')
    expect(data.standings).toHaveLength(4)
    const you = data.standings.at(-1)
    expect(you).toMatchObject({ position: 5, display: 'Você', points: 42, isYou: true })
  })

  it('does not append a row when the user is already on the podium', () => {
    const data = buildShareCardData(
      {
        ...base,
        user_position: 1,
        podium: [
          { position: 1, display: 'Você', points: 152, is_you: true },
          { position: 2, display: 'Ana', points: 140, is_you: false },
        ],
      },
      'https://palpitae.app',
    )
    expect(data.isChampion).toBe(true)
    expect(data.standings).toHaveLength(2)
    expect(data.standings.filter((e) => e.isYou)).toHaveLength(1)
  })

  it('shows only the first name of other participants (no PII leak on a public card)', () => {
    const data = buildShareCardData(
      {
        ...base,
        podium: [{ position: 1, display: 'João da Silva Souza', points: 152, is_you: false }],
      },
      'https://palpitae.app',
    )
    expect(data.standings[0].display).toBe('João')
  })

  it('strips scheme and trailing slash from the domain', () => {
    expect(buildShareCardData(base, 'https://palpitae.app/').domain).toBe('palpitae.app')
    expect(buildShareCardData(base, 'http://localhost:5173').domain).toBe('localhost:5173')
  })

  it('falls back to competition_id when the name is missing', () => {
    const data = buildShareCardData({ ...base, competition_name: null }, 'https://palpitae.app')
    expect(data.competition).toBe('comp-1')
  })
})

describe('drawShareCard', () => {
  function createMockCtx() {
    return {
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      textBaseline: '',
      textAlign: '',
      font: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D
  }

  const baseData: ShareCardData = {
    competition: 'Copa 2026',
    position: 5,
    total: 8,
    isChampion: false,
    standings: [
      { position: 1, display: 'João', points: 152, isYou: false },
      { position: 2, display: 'Ana', points: 140, isYou: false },
      { position: 3, display: 'Rui', points: 131, isYou: false },
      { position: 5, display: 'Você', points: 42, isYou: true },
    ],
    domain: 'palpitae.app',
  }

  it('draws the background, elements, labels and non-champion text', () => {
    const ctx = createMockCtx()
    drawShareCard(ctx, baseData)

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1350)

    // Check specific texts
    const calls = (ctx.fillText as any).mock.calls.map((call: any[]) => call[0])

    // The wordmark 'PALPITAE' and label 'FIQUEI EM' are drawn character by character
    // due to custom tracking in fillTracked, but other parts are drawn fully:
    expect(calls).toContain('COPA 2026')
    expect(calls).toContain('5')
    expect(calls).toContain('de 8 no bolão')
    expect(calls).toContain('João')
    expect(calls).toContain('152')
    expect(calls).toContain('Você')
    expect(calls).toContain('42')
    expect(calls).toContain('dispute o topo da classificação')
    expect(calls).toContain('palpitae.app')

    // We check that the hero champion trophy is not rendered since isChampion=false
    // Note: The big trophy is at y=288, while the standings trophy is at y=968
    const bigTrophyCall = (ctx.fillText as any).mock.calls.find((call: any[]) => call[0] === '🏆' && call[2] === 288)
    expect(bigTrophyCall).toBeFalsy()

    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
  })

  it('draws champion specifics when user is champion', () => {
    const ctx = createMockCtx()
    const champData = { ...baseData, isChampion: true, position: 1 }
    drawShareCard(ctx, champData)

    // Validate big trophy placement logic for champion
    // The big trophy should be rendered at specific coordinates (W / 2, 288)
    const trophyCall = (ctx.fillText as any).mock.calls.find((call: any[]) => call[0] === '🏆' && call[1] === 1080 / 2 && call[2] === 288)
    expect(trophyCall).toBeTruthy()
  })

  it('truncates texts properly', () => {
    const ctx = createMockCtx()
    // Make measureText return large width so truncation happens
    ;(ctx.measureText as any).mockImplementation(() => ({ width: 600 }))
    const longData = {
      ...baseData,
      competition: 'SUPER LONG COMPETITION NAME',
      standings: [
        { position: 1, display: 'VERY LONG NAME THAT EXCEEDS WIDTH', points: 100, isYou: true }
      ]
    }

    drawShareCard(ctx, longData)

    const calls = (ctx.fillText as any).mock.calls.map((call: any[]) => call[0])

    // In our mock logic for truncate, if measureText always returns 600 width (and text+'…' returns 600 width),
    // while loop reduces it until length is 1, so we expect 'S…' or similar depending on the exact string.
    // Wait, let's actually just verify that the full string isn't printed and a truncated string is printed.
    expect(calls).not.toContain('SUPER LONG COMPETITION NAME')
    expect(calls).not.toContain('VERY LONG NAME THAT EXCEEDS WIDTH')

    // Because it slices down to length 1 and adds '…', the string might be 'S…' or 'V…'
    expect(calls.some((c: string) => c.endsWith('…'))).toBe(true)
  })
})
