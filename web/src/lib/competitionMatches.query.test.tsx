import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GroupPicksTab from '../components/GroupPicksTab/GroupPicksTab'
import PredictionsTab from '../components/PredictionsTab/PredictionsTab'
import { makeMatch } from '../components/matchFixtures'
import { createTestQueryClient, renderWithQuery } from '../test-utils'

function json(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response)
}

describe('query de partidas da competição', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('abre Palpites e depois Palpites do grupo com uma única busca de partidas', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    let matchesCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/matches')) {
        matchesCalls += 1
        return json({ matches, default_round: '1' })
      }
      if (u.includes('/predictions/group')) {
        return json({
          self_user_id: 'u1',
          members: [{ user_id: 'u1', display: 'Pedro' }],
          predictions: [],
        })
      }
      if (u.includes('/predictions')) {
        return json({ predictions: [] })
      }
      return Promise.reject(new Error(`Unexpected fetch: ${u}`))
    })

    const queryClient = createTestQueryClient()
    const first = renderWithQuery(<PredictionsTab groupId="g1" competitionId="c1" />, {
      queryClient,
    })
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })
    expect(matchesCalls).toBe(1)
    first.unmount()

    renderWithQuery(
      <GroupPicksTab groupId="g1" competitionId="c1" predictionsVisibility="public" />,
      { queryClient },
    )
    await waitFor(() => {
      expect(screen.queryByText('Carregando palpites do grupo...')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Pedro')).toBeInTheDocument()
    expect(matchesCalls).toBe(1)
  })

  it('trocar de grupo com a busca em andamento não aplica a resposta antiga', async () => {
    const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
    let releaseG1: (() => void) | undefined
    const g1Held = new Promise<Response>((resolve) => {
      releaseG1 = () =>
        resolve({
          ok: true,
          json: async () => ({
            self_user_id: 'u1',
            members: [
              { user_id: 'u1', display: 'DoGrupo1' },
              { user_id: 'u2', display: 'Antigo' },
            ],
            predictions: [
              {
                match_id: 'm1',
                user_id: 'u2',
                user_display: 'Antigo',
                predicted_home_score: 9,
                predicted_away_score: 9,
                points_awarded: 0,
                locked: 0,
              },
            ],
          }),
        } as Response)
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = url.toString()
      if (u.includes('/matches')) {
        return json({ matches, default_round: '1' })
      }
      if (u.includes('/predictions/group')) {
        if (u.includes('group_id=g1')) return g1Held
        if (u.includes('group_id=g2')) {
          return json({
            self_user_id: 'u1',
            members: [
              { user_id: 'u1', display: 'DoGrupo2' },
              { user_id: 'u3', display: 'Novo' },
            ],
            predictions: [
              {
                match_id: 'm1',
                user_id: 'u3',
                user_display: 'Novo',
                predicted_home_score: 1,
                predicted_away_score: 0,
                points_awarded: 0,
                locked: 0,
              },
            ],
          })
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${u}`))
    })

    const queryClient = createTestQueryClient()
    const view = renderWithQuery(
      <GroupPicksTab groupId="g1" competitionId="c1" predictionsVisibility="public" />,
      { queryClient },
    )
    expect(screen.getByText('Carregando palpites do grupo...')).toBeInTheDocument()

    view.rerender(
      <GroupPicksTab groupId="g2" competitionId="c1" predictionsVisibility="public" />,
    )
    releaseG1!()

    await waitFor(() => {
      expect(screen.getByText('Novo')).toBeInTheDocument()
    })
    expect(screen.queryByText('Antigo')).not.toBeInTheDocument()
    expect(screen.getByText('DoGrupo2')).toBeInTheDocument()
  })
})
