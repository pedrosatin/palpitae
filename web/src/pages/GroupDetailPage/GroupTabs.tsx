import React, { type CSSProperties } from 'react'
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

export default function GroupTabs({
  activeTab,
  showStandings,
  isAdmin,
  tabsOffset,
  tabHref,
  onTabClick,
}: GroupTabsProps) {
  return (
    <div
      className={styles.tabs}
      style={{ '--tabs-offset': `${tabsOffset}px` } as CSSProperties}
      data-testid="group-tabs"
    >
      <a
        href={tabHref('predictions')}
        className={`${styles.tab} ${activeTab === 'predictions' ? styles.tabActive : ''}`}
        onClick={(e) => onTabClick(e, 'predictions')}
      >
        Palpitar
      </a>
      {showStandings && (
        <a
          href={tabHref('standings')}
          className={`${styles.tab} ${activeTab === 'standings' ? styles.tabActive : ''}`}
          onClick={(e) => onTabClick(e, 'standings')}
        >
          Tabela
        </a>
      )}
      <a
        href={tabHref('group-picks')}
        className={`${styles.tab} ${activeTab === 'group-picks' ? styles.tabActive : ''}`}
        onClick={(e) => onTabClick(e, 'group-picks')}
      >
        Grupo
      </a>
      <a
        href={tabHref('leaderboard')}
        className={`${styles.tab} ${activeTab === 'leaderboard' ? styles.tabActive : ''}`}
        onClick={(e) => onTabClick(e, 'leaderboard')}
      >
        Ranking
      </a>
      {isAdmin && (
        <a
          href={tabHref('members')}
          className={`${styles.tab} ${activeTab === 'members' ? styles.tabActive : ''}`}
          onClick={(e) => onTabClick(e, 'members')}
        >
          Membros
        </a>
      )}
    </div>
  )
}
