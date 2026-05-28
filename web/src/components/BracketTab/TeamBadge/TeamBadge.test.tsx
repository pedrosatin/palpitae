import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TeamBadge from './TeamBadge'

describe('TeamBadge', () => {
  it('renders the team logo with the short name as alt text', () => {
    render(<TeamBadge short="BRA" logo="/bra.png" />)
    const img = screen.getByRole('img', { name: 'BRA' }) as HTMLImageElement
    expect(img.src).toContain('/bra.png')
  })

  it('renders the short name', () => {
    render(<TeamBadge short="ARG" logo={null} />)
    expect(screen.getByText('ARG')).toBeInTheDocument()
  })

  it('renders a placeholder span when no logo is provided', () => {
    const { container } = render(<TeamBadge short="GER" logo={null} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.teamLogoPlaceholder')).not.toBeNull()
  })
})
