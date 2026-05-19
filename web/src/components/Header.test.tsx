import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Header from './Header'

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
