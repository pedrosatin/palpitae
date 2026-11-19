import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupLinkSection from './GroupLinkSection'

const PUBLIC_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

vi.mock('../../analytics/ga', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../../components/ShareButtons', () => ({
  default: ({ shareLink }: { shareLink: string }) => (
    <div data-testid="share-buttons">{shareLink}</div>
  ),
}))

describe('GroupLinkSection', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mostra o link /grupo/ sem código de convite e copia', async () => {
    render(<GroupLinkSection publicId={PUBLIC_ID} groupName="Firma" />)
    const link = `${window.location.origin}/grupo/${PUBLIC_ID}`
    expect(screen.getAllByText(link).length).toBeGreaterThan(0)
    expect(screen.queryByText(/ABCD-EFGH/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Copiar link/i }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link)
  })
})
