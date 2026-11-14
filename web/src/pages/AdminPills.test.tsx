import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AdminPills from './AdminPills'

const OPTIONS = [
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gama', disabled: true },
]

describe('AdminPills', () => {
  it('renderiza os botões, destaca o ativo e dispara onChange ao clicar', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AdminPills options={OPTIONS} value="a" onChange={onChange} />)

    const alfa = screen.getByRole('button', { name: 'Alfa' })
    const beta = screen.getByRole('button', { name: 'Beta' })
    const gama = screen.getByRole('button', { name: 'Gama' })

    expect(alfa.className).toContain('periodActive')
    expect(beta.className).toContain('period')
    expect(beta.className).not.toContain('periodActive')
    expect(gama).toBeDisabled()

    await user.click(beta)
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('omite role, aria-label e aria-pressed quando opcionais não são informados', () => {
    render(<AdminPills options={OPTIONS} value="a" onChange={vi.fn()} />)

    const alfa = screen.getByRole('button', { name: 'Alfa' })
    expect(alfa.parentElement).not.toHaveAttribute('role')
    expect(alfa.parentElement).not.toHaveAttribute('aria-label')
    expect(alfa).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Beta' })).not.toHaveAttribute('aria-pressed')
  })

  it('aplica role, aria-label, aria-pressed e classe extra quando informados', () => {
    render(
      <AdminPills
        options={OPTIONS}
        value="b"
        onChange={vi.fn()}
        className="grupo-custom"
        role="group"
        ariaLabel="Filtro de letras"
        ariaPressed
      />,
    )

    const group = screen.getByRole('group', { name: 'Filtro de letras' })
    expect(group).toHaveClass('grupo-custom')
    expect(screen.getByRole('button', { name: 'Alfa' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true')
  })
})
