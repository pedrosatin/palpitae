// @vitest-environment jsdom

import '@testing-library/jest-dom'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RenameGroupModal } from './RenameGroupModal'
import { apiFetch } from '../../lib/api'
import { trackEvent } from '../../analytics/ga'
import { invalidateApiCache } from '../../lib/api-cache'

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../lib/api-cache', () => ({
  invalidateApiCache: vi.fn(),
}))

describe('RenameGroupModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    groupId: 'group-123',
    currentName: 'Old Name',
    onRenamed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders correctly with current name', () => {
    render(<RenameGroupModal {...defaultProps} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Editar nome do grupo' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Old Name')).toBeInTheDocument()
  })

  it('shows error when name is too short', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RenameGroupModal {...defaultProps} />)

    const input = screen.getByDisplayValue('Old Name')
    await user.clear(input)
    await user.type(input, 'A')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(screen.getByText('Nome deve ter entre 2 e 30 caracteres')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('submits form successfully', async () => {
    const user = userEvent.setup({ delay: null })
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any)

    render(<RenameGroupModal {...defaultProps} />)

    const input = screen.getByDisplayValue('Old Name')
    await user.clear(input)
    await user.type(input, 'New Name')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/groups/group-123'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
    })

    expect(trackEvent).toHaveBeenCalledWith('submit_renomear_grupo')
    expect(invalidateApiCache).toHaveBeenCalledWith('groups:')
    expect(defaultProps.onRenamed).toHaveBeenCalledWith('New Name')
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('handles API error correctly', async () => {
    const user = userEvent.setup({ delay: null })
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Custom API error' })
    } as any)

    render(<RenameGroupModal {...defaultProps} />)

    const input = screen.getByDisplayValue('Old Name')
    await user.clear(input)
    await user.type(input, 'New Name')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(screen.getByText('Custom API error')).toBeInTheDocument()
    })

    expect(defaultProps.onRenamed).not.toHaveBeenCalled()
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })
})
