import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StackedBarChart, BarChart } from './charts'

describe('charts', () => {
  describe('StackedBarChart', () => {
    it('renders correctly with given days', () => {
      const days = [
        {
          label: '2023-10-01',
          segments: [
            { type: 'login_success', value: 10, color: '#49f21b' },
            { type: 'group_created', value: 2, color: '#4dabf7' },
          ],
        },
        {
          label: '2023-10-02',
          segments: [{ type: 'login_success', value: 15, color: '#49f21b' }],
        },
      ]
      render(<StackedBarChart days={days} ariaLabel="Test Stacked Chart" />)

      expect(screen.getByRole('img', { name: 'Test Stacked Chart' })).toBeInTheDocument()

      // 2 days * (2 + 1) segments = 3 rects
      const rects = document.querySelectorAll('rect')
      expect(rects.length).toBe(3)
      expect(rects[0]).toHaveAttribute('width')
      expect(rects[0].getAttribute('width')).not.toBe('0')

      // Check partial text in tooltips
      const titles = document.querySelectorAll('title')
      expect(titles[0].textContent).toContain('2023-10-01')
      expect(titles[0].textContent).toContain('10')
      expect(titles[1].textContent).toContain('2')
      expect(titles[2].textContent).toContain('2023-10-02')
    })

    it('handles empty days', () => {
      render(<StackedBarChart days={[]} ariaLabel="Empty Chart" />)
      expect(screen.getByRole('img', { name: 'Empty Chart' })).toBeInTheDocument()
      expect(document.querySelectorAll('rect').length).toBe(0)
    })

    it('skips ticks for many labels', () => {
      const days = Array.from({ length: 15 }).map((_, i) => ({
        label: `2023-10-${String(i + 1).padStart(2, '0')}`,
        segments: [{ type: 'login_success', value: 5, color: '#49f21b' }],
      }))

      render(<StackedBarChart days={days} ariaLabel="Many Days" />)

      const texts = document.querySelectorAll('text')
      expect(texts.length).toBeLessThan(15) // ticks should be skipped
      expect(texts[texts.length - 1].textContent).toContain('15') // last is always there
    })
  })

  describe('BarChart', () => {
    it('renders correctly with given series', () => {
      const series = [
        { label: '2023-10-01', total: 42 },
        { label: '2023-10-02', total: 10 },
      ]
      render(<BarChart series={series} ariaLabel="Test Bar Chart" unit=" calls" />)

      expect(screen.getByRole('img', { name: 'Test Bar Chart' })).toBeInTheDocument()

      const rects = document.querySelectorAll('rect')
      expect(rects.length).toBe(2)
      expect(rects[0]).toHaveAttribute('width')
      expect(rects[0].getAttribute('width')).not.toBe('0')

      const titles = document.querySelectorAll('title')
      expect(titles[0].textContent).toBe('2023-10-01: 42 calls')
      expect(titles[1].textContent).toBe('2023-10-02: 10 calls')
    })

    it('handles custom tick labels', () => {
      const series = [{ label: 'Q1', total: 100 }]
      render(
        <BarChart
          series={series}
          ariaLabel="Custom Tick Chart"
          tickLabel={(l) => `Quarter: ${l}`}
        />,
      )

      const text = document.querySelector('text')
      expect(text?.textContent).toBe('Quarter: Q1')
    })
  })
})
