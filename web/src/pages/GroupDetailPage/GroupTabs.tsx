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

const FADE_SIZE = 28
const REVEAL_MARGIN = 32

/**
 * Rola a barra na horizontal até a aba ativa ficar inteira à vista, com folga
 * para não ficar sob o fade das pontas.
 * Não mexe na rolagem vertical da página, ao contrário de scrollIntoView.
 */
export function revealActiveTab(container: HTMLElement, active: HTMLElement) {
  const left = active.offsetLeft
  const right = left + active.offsetWidth
  const viewLeft = container.scrollLeft
  const viewRight = viewLeft + container.clientWidth
  if (left - REVEAL_MARGIN < viewLeft) container.scrollLeft = Math.max(0, left - REVEAL_MARGIN)
  else if (right + REVEAL_MARGIN > viewRight) {
    container.scrollLeft = right - container.clientWidth + REVEAL_MARGIN
  }
}

/** Diz de que lado da barra ainda há aba escondida. */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number) {
  return {
    canScrollStart: scrollLeft > 1,
    canScrollEnd: scrollLeft + clientWidth < scrollWidth - 1,
  }
}

function updateFades(container: HTMLElement) {
  const { canScrollStart, canScrollEnd } = scrollEdges(
    container.scrollLeft,
    container.clientWidth,
    container.scrollWidth,
  )
  container.style.setProperty('--fade-start', canScrollStart ? `${FADE_SIZE}px` : '0px')
  container.style.setProperty('--fade-end', canScrollEnd ? `${FADE_SIZE}px` : '0px')
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
    if (!container) return
    const active = container.querySelector<HTMLElement>('[aria-current="page"]')
    if (active) revealActiveTab(container, active)
    const update = () => updateFades(container)
    update()
    container.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(container)
    return () => {
      container.removeEventListener('scroll', update)
      observer?.disconnect()
    }
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
