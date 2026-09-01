import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { GroupHeader } from './GroupHeader'

describe('GroupHeader', () => {
  const defaultGroup = {
    name: 'My Group',
    competition_id: 'comp1',
    competition_name: 'Competition One',
    member_count: 42,
    user_position: 3,
    user_points: 120,
  }

  const defaultProps = {
    group: defaultGroup,
    isAdmin: false,
    onOpenRename: vi.fn(),
    onDeleteGroup: vi.fn(),
    deleting: false,
    onLeaveGroup: vi.fn(),
    leaving: false,
  }

  it('renders group metadata and stats correctly', () => {
    render(<GroupHeader {...defaultProps} />)

    expect(screen.getByText('Competition One')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Group' })).toBeInTheDocument()

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('membros')).toBeInTheDocument()

    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.getByText('sua posição')).toBeInTheDocument()

    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('pontos')).toBeInTheDocument()
  })

  it('falls back to competition_id when competition_name is null', () => {
    render(<GroupHeader {...defaultProps} group={{ ...defaultGroup, competition_name: null }} />)
    expect(screen.getByText('comp1')).toBeInTheDocument()
  })

  describe('GroupMenu - Non-Admin', () => {
    it('shows only leave group option', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GroupHeader {...defaultProps} />)

      const menuBtn = screen.getByRole('button', { name: 'Opções do grupo' })
      await user.click(menuBtn)

      const leaveBtn = screen.getByRole('menuitem', { name: 'Sair do grupo' })
      expect(leaveBtn).toBeInTheDocument()

      expect(screen.queryByRole('menuitem', { name: 'Editar nome' })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Excluir grupo' })).not.toBeInTheDocument()
    })

    it('calls onLeaveGroup when clicking leave group', async () => {
      const user = userEvent.setup({ delay: null })
      const onLeaveGroup = vi.fn()
      render(<GroupHeader {...defaultProps} onLeaveGroup={onLeaveGroup} />)

      await user.click(screen.getByRole('button', { name: 'Opções do grupo' }))
      await user.click(screen.getByRole('menuitem', { name: 'Sair do grupo' }))

      expect(onLeaveGroup).toHaveBeenCalledTimes(1)
    })

    it('shows leaving text and disables button when leaving is true', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GroupHeader {...defaultProps} leaving={true} />)

      await user.click(screen.getByRole('button', { name: 'Opções do grupo' }))

      const leaveBtn = screen.getByRole('menuitem', { name: 'Saindo...' })
      expect(leaveBtn).toBeInTheDocument()
      expect(leaveBtn).toBeDisabled()
    })
  })

  describe('GroupMenu - Admin', () => {
    const adminProps = { ...defaultProps, isAdmin: true }

    it('shows edit and delete options', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GroupHeader {...adminProps} />)

      const menuBtn = screen.getByRole('button', { name: 'Opções do grupo' })
      await user.click(menuBtn)

      expect(screen.getByRole('menuitem', { name: 'Editar nome' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Excluir grupo' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Sair do grupo' })).not.toBeInTheDocument()
    })

    it('calls admin actions correctly', async () => {
      const user = userEvent.setup({ delay: null })
      const onOpenRename = vi.fn()
      const onDeleteGroup = vi.fn()
      render(
        <GroupHeader {...adminProps} onOpenRename={onOpenRename} onDeleteGroup={onDeleteGroup} />,
      )

      await user.click(screen.getByRole('button', { name: 'Opções do grupo' }))
      await user.click(screen.getByRole('menuitem', { name: 'Editar nome' }))
      expect(onOpenRename).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'Opções do grupo' }))
      await user.click(screen.getByRole('menuitem', { name: 'Excluir grupo' }))
      expect(onDeleteGroup).toHaveBeenCalledTimes(1)
    })

    it('shows deleting text and disables button when deleting is true', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GroupHeader {...adminProps} deleting={true} />)

      await user.click(screen.getByRole('button', { name: 'Opções do grupo' }))

      const deleteBtn = screen.getByRole('menuitem', { name: 'Excluindo...' })
      expect(deleteBtn).toBeInTheDocument()
      expect(deleteBtn).toBeDisabled()
    })
  })

  describe('GroupMenu - Interactions', () => {
    it('closes menu on escape key', async () => {
      const user = userEvent.setup({ delay: null })
      render(<GroupHeader {...defaultProps} />)

      const menuBtn = screen.getByRole('button', { name: 'Opções do grupo' })
      await user.click(menuBtn)
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes menu on outside click', async () => {
      const user = userEvent.setup({ delay: null })
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <GroupHeader {...defaultProps} />
        </div>,
      )

      const menuBtn = screen.getByRole('button', { name: 'Opções do grupo' })
      await user.click(menuBtn)
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.click(screen.getByTestId('outside'))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})
