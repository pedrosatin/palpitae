import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Avatar from './Avatar'

function photo(container: HTMLElement) {
  return container.querySelector('img')
}

describe('Avatar', () => {
  it('mostra a foto sem texto alternativo', () => {
    const { container } = render(<Avatar name="Ana" src="https://example.com/a.png" />)
    expect(photo(container)).toHaveAttribute('src', 'https://example.com/a.png')
    expect(photo(container)).toHaveAttribute('alt', '')
    expect(screen.queryByText('A')).not.toBeInTheDocument()
  })

  it('mostra a inicial em maiúscula quando não há foto', () => {
    const { container } = render(<Avatar name="ana" src={null} />)
    expect(photo(container)).toBeNull()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('mantém um emoji inteiro como inicial', () => {
    render(<Avatar name="🦊 Raposa" />)
    expect(screen.getByText('🦊')).toBeInTheDocument()
  })

  it('não quebra com nome vazio', () => {
    const { container } = render(<Avatar name="" />)
    expect(photo(container)).toBeNull()
    expect(container.firstElementChild).toBeEmptyDOMElement()
  })

  it('troca a foto quebrada pela inicial', () => {
    const { container } = render(<Avatar name="Bia" src="https://example.com/quebrada.png" />)
    fireEvent.error(photo(container)!)
    expect(photo(container)).toBeNull()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('volta a mostrar a foto quando a URL muda depois da falha', () => {
    const { container, rerender } = render(<Avatar name="Bia" src="https://example.com/x.png" />)
    fireEvent.error(photo(container)!)
    rerender(<Avatar name="Bia" src="https://example.com/y.png" />)
    expect(photo(container)).toHaveAttribute('src', 'https://example.com/y.png')
  })

  it('aplica as classes de quem usa', () => {
    const { container } = render(<Avatar name="Cris" className="tamanho" fallbackClassName="so" />)
    expect(container.firstElementChild).toHaveClass('tamanho', 'so')
  })
})
