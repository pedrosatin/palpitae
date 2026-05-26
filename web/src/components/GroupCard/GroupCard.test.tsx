import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GroupCard from './GroupCard'

const baseGroup = {
  id: 'group-1',
  name: 'Meu Grupo',
  is_admin: false,
  competition_id: 'comp-1',
  created_at: '2026-01-01T00:00:00Z',
  member_count: 5,
  user_position: 2,
  user_points: 10,
}

describe('GroupCard', () => {
  const onClick = vi.fn()

  beforeEach(() => {
    onClick.mockClear()
  })

  it('renders group name', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.getByText('Meu Grupo')).toBeInTheDocument()
  })

  it('renders member count, position and points', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('shows Admin badge when currentUser is the admin', () => {
    render(
      <GroupCard group={{ ...baseGroup, is_admin: true }} onClick={onClick} />,
    )
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('does not show Admin badge for non-admin users', () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('calls onClick when the card button is clicked', async () => {
    render(<GroupCard group={baseGroup} onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: /Abrir grupo/i }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
