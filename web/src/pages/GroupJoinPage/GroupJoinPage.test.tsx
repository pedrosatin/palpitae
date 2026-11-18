import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupJoinPage from './GroupJoinPage'

const PUBLIC_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

vi.mock('../../analytics/funnel', () => ({
  trackJoinRequest: vi.fn(),
  trackJoinGroup: vi.fn(),
}))

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return {
    ...actual,
    apiFetch: vi.fn(),
    readApiError: actual.readApiError,
  }
})

import { apiFetch } from '../../lib/api'
import { trackJoinRequest } from '../../analytics/funnel'

describe('GroupJoinPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          group: {
            group_name: 'Bolão da Firma',
            competition_name: 'Brasileirão',
            member_count: 3,
            join_requests_enabled: true,
          },
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('mostra prévia sem nomes de membros', async () => {
    render(
      <MemoryRouter initialEntries={[`/grupo/${PUBLIC_ID}`]}>
        <Routes>
          <Route path="/grupo/:publicId" element={<GroupJoinPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Bolão da Firma' })).toBeInTheDocument()
    expect(screen.getByText('Brasileirão')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText(/Dono|Membro|admin/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Entrar com Google para pedir/i)).toBeInTheDocument()
  })

  it('usuário logado envia pedido', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      Response.json({ request: { id: 'r1', status: 'pending' } }, { status: 201 }),
    )

    render(
      <MemoryRouter initialEntries={[`/grupo/${PUBLIC_ID}`]}>
        <Routes>
          <Route
            path="/grupo/:publicId"
            element={<GroupJoinPage user={{ id: 'u1', email: 'a@b.com', nickname: 'Ana' }} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: 'Bolão da Firma' })
    await userEvent.click(screen.getByTestId('pedir-entrada'))
    await waitFor(() => expect(trackJoinRequest).toHaveBeenCalled())
    expect(await screen.findByText(/Pedido enviado/i)).toBeInTheDocument()
  })
})
