import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import GroupTabs, { revealActiveTab } from './GroupTabs'
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
    renderWithRouter(<GroupTabs {...defaultProps} showStandings={true} activeTab={'standings' as Tab} />)
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

  it('marca só a aba ativa com aria-current', () => {
    renderWithRouter(<GroupTabs {...defaultProps} activeTab={'group-picks' as Tab} />)
    expect(screen.getByRole('link', { name: 'Grupo' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Palpitar' })).not.toHaveAttribute('aria-current')
  })
})

describe('revealActiveTab', () => {
  const build = (scrollLeft: number, tab: { left: number; width: number }) => {
    const container = document.createElement('div')
    const active = document.createElement('a')
    Object.defineProperty(container, 'clientWidth', { value: 358 })
    Object.defineProperty(active, 'offsetLeft', { value: tab.left })
    Object.defineProperty(active, 'offsetWidth', { value: tab.width })
    container.scrollLeft = scrollLeft
    return { container, active }
  }

  it('leva a aba escondida à direita até a borda direita', () => {
    const { container, active } = build(0, { left: 350, width: 97 })
    revealActiveTab(container, active)
    expect(container.scrollLeft).toBe(89)
  })

  it('leva a aba escondida à esquerda até a borda esquerda', () => {
    const { container, active } = build(120, { left: 40, width: 80 })
    revealActiveTab(container, active)
    expect(container.scrollLeft).toBe(40)
  })

  it('não rola quando a aba já cabe', () => {
    const { container, active } = build(0, { left: 10, width: 80 })
    revealActiveTab(container, active)
    expect(container.scrollLeft).toBe(0)
  })
})
