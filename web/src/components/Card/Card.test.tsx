import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Card from './Card'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('renders without hoverable class by default', () => {
    const { container } = render(<Card>Content</Card>)
    const div = container.firstChild as HTMLElement
    expect(div.className).not.toMatch(/hoverable/)
  })

  it('renders with hoverable class when hoverable prop is true', () => {
    const { container } = render(<Card hoverable>Content</Card>)
    const div = container.firstChild as HTMLElement
    expect(div.className).toMatch(/hoverable/)
  })

  it('appends custom className', () => {
    const { container } = render(<Card className="custom">Content</Card>)
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('custom')
  })
})
