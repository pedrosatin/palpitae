import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ga from '../../analytics/ga'
import Header from './Header'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))
const mockTrackEvent = vi.mocked(ga.trackEvent)

const baseUser = {
  email: 'user@example.com',
  nickname: 'TestUser',
  avatar_url: undefined,
  feature_flags: {
    create_group: true,
  },
}

function renderHeader(props?: Partial<Parameters<typeof Header>[0]>) {
  const defaults = {
    user: baseUser,
    onCreateGroup: vi.fn(),
    onJoinGroup: vi.fn(),
    onLogout: vi.fn(),
  }
  return render(<Header {...defaults} {...props} />)
}

describe('Header', () => {
  it('renders action buttons', () => {
    renderHeader()
    expect(
      screen.getByRole('button', { name: 'Criar grupo' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Entrar em grupo' }),
    ).toBeInTheDocument()
  })

  it('calls onCreateGroup when Criar grupo is clicked', async () => {
    const onCreateGroup = vi.fn()
    renderHeader({ onCreateGroup })
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))
    expect(onCreateGroup).toHaveBeenCalledOnce()
  })

  it('calls onJoinGroup when Entrar em grupo is clicked', async () => {
    const onJoinGroup = vi.fn()
    renderHeader({ onJoinGroup })
    await userEvent.click(
      screen.getByRole('button', { name: 'Entrar em grupo' }),
    )
    expect(onJoinGroup).toHaveBeenCalledOnce()
  })

  it('hides Criar grupo when the user cannot create groups', () => {
    renderHeader({
      user: {
        ...baseUser,
        feature_flags: { create_group: false },
      },
    })
    expect(
      screen.queryByRole('button', { name: 'Criar grupo' }),
    ).not.toBeInTheDocument()
  })

  it('shows user nickname in menu trigger', () => {
    renderHeader()
    expect(screen.getByText('TestUser')).toBeInTheDocument()
  })

  it('shows user email when no nickname', () => {
    renderHeader({ user: { email: 'user@example.com' } })
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
  })

  it('opens dropdown and calls onLogout when Sair is clicked', async () => {
    const onLogout = vi.fn()
    renderHeader({ onLogout })
    await userEvent.click(screen.getByText('TestUser'))
    const sairBtn = screen.getByRole('button', { name: 'Sair' })
    await userEvent.click(sairBtn)
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('renders logo as a link to home', () => {
    renderHeader()
    const link = screen.getByRole('link', { name: 'Ir para a home' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/')
  })
})

describe('Header – analytics', () => {
  beforeEach(() => mockTrackEvent.mockClear())

  it('fires click_header_entrar_grupo when Entrar em grupo is clicked', async () => {
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: 'Entrar em grupo' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_header_entrar_grupo')
  })

  it('fires click_header_criar_grupo when Criar grupo is clicked', async () => {
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_header_criar_grupo')
  })

  it('fires click_header_user_menu when the user avatar/name is clicked', async () => {
    renderHeader()
    await userEvent.click(screen.getByText('TestUser'))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_header_user_menu')
  })

  it('fires click_header_logout when Sair is clicked', async () => {
    renderHeader()
    await userEvent.click(screen.getByText('TestUser'))
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_header_logout')
  })

  it('fires click_header_logo when the logo link is clicked', async () => {
    renderHeader()
    await userEvent.click(screen.getByRole('link', { name: 'Ir para a home' }))
    expect(mockTrackEvent).toHaveBeenCalledWith('click_header_logo')
  })
})
