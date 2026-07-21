import { describe, it, expect } from 'vitest'
import { buildShareCardData } from './shareCard'
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
