import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ConfirmModal from './ConfirmModal'

describe('ConfirmModal', () => {
  const defaultProps = {
    isOpen: true,
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup({ delay: null })
    vi.clearAllMocks()
  })

  it('renders correctly when open', () => {
    render(<ConfirmModal {...defaultProps} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Confirmar' })).toBeInTheDocument() // Default title
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(<ConfirmModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders with custom labels and title', () => {
    render(
      <ConfirmModal
        {...defaultProps}
        title="Custom Title"
        confirmLabel="Yes, do it"
        cancelLabel="No, wait"
      />
    )

    expect(screen.getByText('Custom Title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes, do it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No, wait' })).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    render(<ConfirmModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(defaultProps.onConfirm).toHaveBeenCalledOnce()
    expect(defaultProps.onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when cancel button is clicked', async () => {
    render(<ConfirmModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(defaultProps.onCancel).toHaveBeenCalledOnce()
    expect(defaultProps.onConfirm).not.toHaveBeenCalled()
  })

  it('disables buttons and shows loading text when loading is true', () => {
    render(<ConfirmModal {...defaultProps} loading={true} />)

    const cancelButton = screen.getByRole('button', { name: 'Cancelar' })
    const confirmButton = screen.getByRole('button', { name: 'Aguarde…' })

    expect(cancelButton).toBeDisabled()
    expect(confirmButton).toBeDisabled()
  })

  it('applies danger styling when danger is true', () => {
    // This mostly tests that it doesn't crash since we can't easily test the exact CSS module class name
    // without more complex setup, but we verify it renders correctly.
    render(<ConfirmModal {...defaultProps} danger={true} />)

    const confirmButton = screen.getByRole('button', { name: 'Confirmar' })
    expect(confirmButton).toBeInTheDocument()
    // It should have some class applied from styles.danger, but since non-scoped CSS Modules are used in tests,
    // it will have class "danger". Let's verify that.
    expect(confirmButton).toHaveClass('danger')
  })
})
