import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MemberBadge from './MemberBadge'

describe('MemberBadge', () => {
  it('mostra "admin" na variante owner', () => {
    render(<MemberBadge variant="owner" />)
    expect(screen.getByText('admin')).toBeInTheDocument()
  })

  it('mostra "você" na variante self', () => {
    render(<MemberBadge variant="self" />)
    expect(screen.getByText('você')).toBeInTheDocument()
  })

  it('soma a classe do lugar de uso à da variante', () => {
    render(<MemberBadge variant="owner" className="extra" />)
    expect(screen.getByText('admin')).toHaveClass('extra')
    expect(screen.getByText('admin').className).not.toBe('extra')
  })
})
