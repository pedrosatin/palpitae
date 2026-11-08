import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvitePage from './InvitePage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

const CODE = 'ABCD-EF23'
const CTA = 'Entrar com Google e participar'

const API_INVITE = {
  group_name: 'Realidade do BR',
  competition_name: 'Brasileirão Série A',
  member_count: 6,
  admin_name: 'Pedro',
  points_exact: 3,
  points_winner: 1,
}

function mockApi(status: number, body: unknown = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

function embedInvite(code: string, invite: unknown = API_INVITE) {
  const root = document.createElement('div')
  root.id = 'root'
  root.dataset.convite = encodeURIComponent(JSON.stringify({ code, invite }))
  document.body.appendChild(root)
}

function renderPage(code: string = CODE) {
  return render(
    <MemoryRouter initialEntries={[`/convite/${code}`]}>
      <Routes>
        <Route path="/convite/:code" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function expectInviteDetails() {
  expect(screen.getByRole('heading', { level: 1, name: 'Realidade do BR' })).toBeInTheDocument()
  expect(screen.getByText('Brasileirão Série A')).toBeInTheDocument()
  expect(screen.getByText('Pedro')).toBeInTheDocument()
  expect(screen.getByText('6')).toBeInTheDocument()
  expect(screen.getByText('3 pontos no placar exato, 1 no resultado')).toBeInTheDocument()
  expect(screen.getByText('Grátis, sem apostas')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: CTA })).toBeInTheDocument()
}

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  document.getElementById('root')?.remove()
  vi.restoreAllMocks()
})

describe('InvitePage com convite válido', () => {
  it('pinta o grupo com os dados embutidos, sem chamar a API', () => {
    embedInvite(CODE)
    const fetchSpy = mockApi(500)

    renderPage()

    expectInviteDetails()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('busca na API quando o HTML veio sem os dados', async () => {
    const fetchSpy = mockApi(200, { invite: API_INVITE })

    renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Realidade do BR' })
    expectInviteDetails()
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(`/public/invites/${CODE}`)
  })

  it('ignora dados embutidos de outro convite', async () => {
    embedInvite('WXYZ-2345', { ...API_INVITE, group_name: 'Outro grupo' })
    mockApi(200, { invite: API_INVITE })

    renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Realidade do BR' })
    expect(screen.queryByText('Outro grupo')).not.toBeInTheDocument()
  })

  it('aceita o código em minúsculas', () => {
    embedInvite(CODE)
    mockApi(500)

    renderPage('abcd-ef23')

    expectInviteDetails()
  })

  it('omite admin e pontuação quando a API não traz', () => {
    embedInvite(CODE, {
      group_name: 'Sem dono',
      competition_name: null,
      member_count: 2,
      admin_name: null,
      points_exact: null,
      points_winner: null,
    })

    renderPage()

    expect(screen.queryByText('Quem administra')).not.toBeInTheDocument()
    expect(screen.queryByText('Pontuação')).not.toBeInTheDocument()
    expect(screen.queryByText('Campeonato')).not.toBeInTheDocument()
  })

  it('não mostra e-mail nem dado de membro que venha na resposta', async () => {
    mockApi(200, {
      invite: {
        ...API_INVITE,
        admin_email: 'pedro@example.com',
        members: [{ name: 'Maria Silva', email: 'maria@example.com' }],
      },
    })

    const { container } = renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Realidade do BR' })
    expect(container.textContent).not.toContain('@')
    expect(container.textContent).not.toContain('Maria')
  })

  it('mantém a marca e o redirect do convite ao tocar no botão', async () => {
    embedInvite(CODE)
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '', pathname: `/convite/${CODE}`, search: '' },
    })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: CTA }))

    const target = new URL(window.location.href)
    expect(target.pathname).toBe('/auth/google')
    expect(target.searchParams.get('redirect')).toBe(`?convite=${CODE}`)
    expect(sessionStorage.getItem('palpitae:convite-aceito')).toBe(CODE)
  })
})

describe('InvitePage com convite inválido', () => {
  it('mostra o aviso com caminho para a landing quando a API responde 404', async () => {
    mockApi(404, { error: 'Convite não encontrado' })

    renderPage()

    await screen.findByRole('heading', { name: 'Este convite não vale mais' })
    expect(screen.getByText('Peça um link novo a quem te convidou.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Conhecer o Palpitae' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: CTA })).not.toBeInTheDocument()
  })

  it('deixa quem tem conta entrar para conferir o convite', async () => {
    mockApi(404)

    renderPage()

    const link = await screen.findByRole('link', { name: 'Já tem conta? Entre para conferir' })
    expect(link).toHaveAttribute('href', `/entrar?convite=${CODE}`)
    expect(sessionStorage.getItem('palpitae:convite-aceito')).toBeNull()
  })

  it.each(['nao-e-codigo', 'ABCD-EF01', 'abc'])(
    'não consulta a API para o código malformado %s',
    (code) => {
      const fetchSpy = mockApi(200, { invite: API_INVITE })

      renderPage(code)

      expect(
        screen.getByRole('heading', { name: 'Este convite não vale mais' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Já tem conta? Entre para conferir')).not.toBeInTheDocument()
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )
})

describe('InvitePage com a API indisponível', () => {
  it.each([429, 500])('mantém o convite de pé com a resposta %i', async (status) => {
    mockApi(status)

    renderPage()

    const heading = await screen.findByRole('heading', {
      name: 'Você recebeu um convite para um bolão',
    })
    expect(heading).toBeInTheDocument()
    expect(screen.queryByText('Este convite não vale mais')).not.toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('button', { name: CTA })).toBeInTheDocument()
  })

  it('mostra só o carregamento enquanto a API não responde', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByText('Carregando convite...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: CTA })).not.toBeInTheDocument()
  })
})
