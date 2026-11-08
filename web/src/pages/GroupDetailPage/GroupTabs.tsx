import React, { type CSSProperties, useEffect, useRef } from 'react'
import { type Tab } from './types'
import styles from './GroupDetailPage.module.css'

interface GroupTabsProps {
  activeTab: Tab
  showStandings: boolean
  isAdmin: boolean
  tabsOffset: number
  tabHref: (tab: Tab) => string
  onTabClick: (e: React.MouseEvent<HTMLAnchorElement>, tab: Tab) => void
}

/**
 * Rola a barra na horizontal até a aba ativa ficar inteira à vista.
 * Não mexe na rolagem vertical da página, ao contrário de scrollIntoView.
 */
export function revealActiveTab(container: HTMLElement, active: HTMLElement) {
  const left = active.offsetLeft
  const right = left + active.offsetWidth
  const viewLeft = container.scrollLeft
  const viewRight = viewLeft + container.clientWidth
  if (left < viewLeft) container.scrollLeft = left
  else if (right > viewRight) container.scrollLeft = right - container.clientWidth
}

export default function GroupTabs({
  activeTab,
  showStandings,
  isAdmin,
  tabsOffset,
  tabHref,
  onTabClick,
}: GroupTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const active = container?.querySelector<HTMLElement>('[aria-current="page"]')
    if (container && active) revealActiveTab(container, active)
  }, [activeTab, showStandings, isAdmin])

  return (
    <div
      ref={containerRef}
      className={styles.tabs}
      style={{ '--tabs-offset': `${tabsOffset}px` } as CSSProperties}
      data-testid="group-tabs"
    >
      <a
        href={tabHref('predictions')}
        className={`${styles.tab} ${activeTab === 'predictions' ? styles.tabActive : ''}`}
        aria-current={activeTab === 'predictions' ? 'page' : undefined}
        onClick={(e) => onTabClick(e, 'predictions')}
      >
        Palpitar
      </a>
      {showStandings && (
        <a
          href={tabHref('standings')}
          className={`${styles.tab} ${activeTab === 'standings' ? styles.tabActive : ''}`}
          aria-current={activeTab === 'standings' ? 'page' : undefined}
          onClick={(e) => onTabClick(e, 'standings')}
        >
          Tabela
        </a>
      )}
      <a
        href={tabHref('group-picks')}
        className={`${styles.tab} ${activeTab === 'group-picks' ? styles.tabActive : ''}`}
        aria-current={activeTab === 'group-picks' ? 'page' : undefined}
        onClick={(e) => onTabClick(e, 'group-picks')}
      >
        Grupo
      </a>
      <a
        href={tabHref('leaderboard')}
        className={`${styles.tab} ${activeTab === 'leaderboard' ? styles.tabActive : ''}`}
        aria-current={activeTab === 'leaderboard' ? 'page' : undefined}
        onClick={(e) => onTabClick(e, 'leaderboard')}
      >
        Ranking
      </a>
      {isAdmin && (
        <a
          href={tabHref('members')}
          className={`${styles.tab} ${activeTab === 'members' ? styles.tabActive : ''}`}
          aria-current={activeTab === 'members' ? 'page' : undefined}
          onClick={(e) => onTabClick(e, 'members')}
        >
          Membros
        </a>
      )}
    </div>
  )
}
