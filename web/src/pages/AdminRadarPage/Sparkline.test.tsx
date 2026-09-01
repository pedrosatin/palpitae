import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sparkline } from './Sparkline'

describe('Sparkline', () => {
  it('returns null se tiver menos de 2 pontos válidos', () => {
    const { container } = render(<Sparkline series={[{ day: '1', views: 10 }]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renderiza corretamente com pontos válidos', () => {
    const series = [
      { day: '1', views: 10 },
      { day: '2', views: 20 },
      { day: '3', views: 30 },
    ]
    render(<Sparkline series={series} />)
    const svg = screen.getByRole('img')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-label', 'Variação diária: mínimo 10, máximo 30')
    const path = svg.querySelector('path')
    expect(path).toBeInTheDocument()
    expect(path).toHaveAttribute('d', 'M0.0,19.0 L36.0,10.0 L72.0,1.0')
  })

  it('ignora visualizações nulas', () => {
    const series = [
      { day: '1', views: 10 },
      { day: '2', views: null },
      { day: '3', views: 30 },
    ]
    render(<Sparkline series={series} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', 'Variação diária: mínimo 10, máximo 30')
    const path = svg.querySelector('path')
    expect(path).toHaveAttribute('d', 'M0.0,19.0 L72.0,1.0')
  })

  it('lida com série de variação nula (span zero)', () => {
    const series = [
      { day: '1', views: 10 },
      { day: '2', views: 10 },
    ]
    render(<Sparkline series={series} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', 'Variação diária: mínimo 10, máximo 10')
    const path = svg.querySelector('path')
    expect(path).toHaveAttribute('d', 'M0.0,19.0 L72.0,19.0')
  })
})
