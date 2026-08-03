import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Select from './Select'

describe('Select', () => {
  it('renders children', () => {
    render(
      <Select>
        <option value="1">Option 1</option>
        <option value="2">Option 2</option>
      </Select>
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument()
  })

  it('calls onChange when selection changes', async () => {
    const user = userEvent.setup({ delay: null })
    const onChange = vi.fn()
    render(
      <Select onChange={onChange}>
        <option value="1">Option 1</option>
        <option value="2">Option 2</option>
      </Select>
    )

    await user.selectOptions(screen.getByRole('combobox'), '2')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('option', { name: 'Option 2' }) as HTMLOptionElement).selected).toBe(true)
  })

  it('applies custom className alongside default styles', () => {
    render(
      <Select className="custom-class">
        <option value="1">Option 1</option>
      </Select>
    )
    expect(screen.getByRole('combobox')).toHaveClass('custom-class')
  })

  it('is disabled when disabled prop is set', () => {
    render(
      <Select disabled>
        <option value="1">Option 1</option>
      </Select>
    )
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('applies other select attributes', () => {
    render(
      <Select name="my-select" required>
        <option value="1">Option 1</option>
      </Select>
    )
    const select = screen.getByRole('combobox')
    expect(select).toHaveAttribute('name', 'my-select')
    expect(select).toBeRequired()
  })
})
