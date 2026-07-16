import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { useConfirm } from './useConfirm'

function TestComponent() {
  const { confirm, confirmDialog } = useConfirm()
  const [result, setResult] = useState<string>('idle')

  const handleConfirm = async () => {
    const res = await confirm({
      title: 'Test Title',
      message: 'Test Message',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    })
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
  it('should initially not show the modal', () => {
    render(<TestComponent />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should open the modal with provided options when confirm is triggered', async () => {
    render(<TestComponent />)
    const triggerButton = screen.getByText('Trigger Confirm')
    await userEvent.click(triggerButton)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test Message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
  })

  it('should resolve with true and close modal when confirm button is clicked', async () => {
    render(<TestComponent />)

    await userEvent.click(screen.getByText('Trigger Confirm'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const confirmButton = screen.getByRole('button', { name: 'Yes' })
    await userEvent.click(confirmButton)

    expect(screen.getByTestId('result')).toHaveTextContent('confirmed')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should resolve with false and close modal when cancel button is clicked', async () => {
    render(<TestComponent />)

    await userEvent.click(screen.getByText('Trigger Confirm'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const cancelButton = screen.getByRole('button', { name: 'No' })
    await userEvent.click(cancelButton)

    expect(screen.getByTestId('result')).toHaveTextContent('canceled')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
