import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import GroupTabs from './GroupTabs'
import { type Tab } from './types'

describe('GroupTabs', () => {
  const defaultProps = {
    activeTab: 'predictions' as Tab,
    showStandings: false,
    isAdmin: false,
    tabsOffset: 10,
    tabHref: (tab: Tab) => `/test/${tab}`,
    onTabClick: vi.fn(),
  }

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>)
  }

  it('renders default tabs with correct labels and hrefs', () => {
    renderWithRouter(<GroupTabs {...defaultProps} />)

    const predictionsTab = screen.getByRole('link', { name: 'Palpitar' })
    expect(predictionsTab).toBeInTheDocument()
    expect(predictionsTab).toHaveAttribute('href', '/test/predictions')
    // active styling should be present
    expect(predictionsTab.className).toContain('tabActive')

    const groupPicksTab = screen.getByRole('link', { name: 'Grupo' })
    expect(groupPicksTab).toBeInTheDocument()
    expect(groupPicksTab).toHaveAttribute('href', '/test/group-picks')
    expect(groupPicksTab.className).not.toContain('tabActive')

    const leaderboardTab = screen.getByRole('link', { name: 'Ranking' })
    expect(leaderboardTab).toBeInTheDocument()
    expect(leaderboardTab).toHaveAttribute('href', '/test/leaderboard')
    expect(leaderboardTab.className).not.toContain('tabActive')

    // Optional tabs shouldn't be rendered
    expect(screen.queryByRole('link', { name: 'Tabela' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Membros' })).not.toBeInTheDocument()
  })

  it('renders Tabela tab when showStandings is true', () => {
    renderWithRouter(
      <GroupTabs {...defaultProps} showStandings={true} activeTab={'standings' as Tab} />,
    )
    const standingsTab = screen.getByRole('link', { name: 'Tabela' })
    expect(standingsTab).toBeInTheDocument()
    expect(standingsTab).toHaveAttribute('href', '/test/standings')
    expect(standingsTab.className).toContain('tabActive')
  })

  it('renders Membros tab when isAdmin is true', () => {
    renderWithRouter(<GroupTabs {...defaultProps} isAdmin={true} activeTab={'members' as Tab} />)
    const membersTab = screen.getByRole('link', { name: 'Membros' })
    expect(membersTab).toBeInTheDocument()
    expect(membersTab).toHaveAttribute('href', '/test/members')
    expect(membersTab.className).toContain('tabActive')
  })

  it('calls onTabClick when a tab is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    const onTabClick = vi.fn()
    renderWithRouter(<GroupTabs {...defaultProps} onTabClick={onTabClick} />)

    await user.click(screen.getByRole('link', { name: 'Grupo' }))
    expect(onTabClick).toHaveBeenCalledTimes(1)
    expect(onTabClick).toHaveBeenCalledWith(expect.anything(), 'group-picks')
  })

  it('applies --tabs-offset custom property to the container', () => {
    renderWithRouter(<GroupTabs {...defaultProps} tabsOffset={42} />)
    const container = screen.getByTestId('group-tabs')
    expect(container).toHaveStyle({ '--tabs-offset': '42px' })
  })
})
