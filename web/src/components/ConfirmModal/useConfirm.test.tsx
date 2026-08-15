import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { useConfirm } from './useConfirm'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

function TestComponent({ options }: { options: ConfirmOptions }) {
  const { confirm, confirmDialog } = useConfirm()
  const [result, setResult] = useState<string>('idle')

  const handleConfirm = async () => {
    const res = await confirm(options)
    setResult(res ? 'confirmed' : 'canceled')
  }

  return (
    <div>
      <button onClick={handleConfirm}>Trigger Confirm</button>
      <div data-testid="result">{result}</div>
      {confirmDialog}
    </div>
  )
}

describe('useConfirm', () => {
  const defaultOptions = {
    title: 'Test Title',
    message: 'Test Message',
    confirmLabel: 'Yes',
    cancelLabel: 'No',
  }

  it('should initially not show the modal', () => {
    render(<TestComponent options={defaultOptions} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should open the modal with provided options when confirm is triggered', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TestComponent options={defaultOptions} />)
    const triggerButton = screen.getByText('Trigger Confirm')
    await user.click(triggerButton)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test Message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
  })

  it('should resolve with true and close modal when confirm button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TestComponent options={defaultOptions} />)

    await user.click(screen.getByText('Trigger Confirm'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const confirmButton = screen.getByRole('button', { name: 'Yes' })
    await user.click(confirmButton)

    expect(screen.getByTestId('result')).toHaveTextContent('confirmed')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should resolve with false and close modal when cancel button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TestComponent options={defaultOptions} />)

    await user.click(screen.getByText('Trigger Confirm'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const cancelButton = screen.getByRole('button', { name: 'No' })
    await user.click(cancelButton)

    expect(screen.getByTestId('result')).toHaveTextContent('canceled')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should use default labels when only message is provided', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TestComponent options={{ message: 'Just a message' }} />)

    await user.click(screen.getByText('Trigger Confirm'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Just a message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('should apply the danger class to the confirm button when danger option is true', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TestComponent options={{ message: 'Danger zone', danger: true, confirmLabel: 'Delete' }} />)

    await user.click(screen.getByText('Trigger Confirm'))

    const confirmButton = screen.getByRole('button', { name: 'Delete' })
    expect(confirmButton.className).toContain('danger')
  })
})
