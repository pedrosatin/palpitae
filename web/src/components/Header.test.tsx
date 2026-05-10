import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Header from './Header'

const baseUser = {
  email: 'user@example.com',
  nickname: 'TestUser',
  avatar_url: undefined,
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
  it('renders action buttons when no onBack prop', () => {
    renderHeader()
    expect(
      screen.getByRole('button', { name: 'Criar grupo' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Entrar em grupo' }),
    ).toBeInTheDocument()
  })

  it('renders back button when onBack is provided', () => {
    renderHeader({ onBack: vi.fn() })
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Criar grupo' }),
    ).not.toBeInTheDocument()
  })

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn()
    renderHeader({ onBack })
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(onBack).toHaveBeenCalledOnce()
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

  it('renders logo as clickable when onHome is provided', () => {
    const onHome = vi.fn()
    renderHeader({ onHome })
    expect(
      screen.getByRole('button', { name: 'Ir para a home' }),
    ).toBeInTheDocument()
  })
})
