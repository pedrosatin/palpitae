import { useEffect, useRef, useState } from 'react'
import TeamBadge from '../TeamBadge'
import type { AvailableTeamsResult, Team } from '../types'
import styles from './TeamPicker.module.css'

interface TeamPickerProps {
  available: AvailableTeamsResult
  currentPick: string | null // team_id
  onPick: (teamId: string) => void
  locked: boolean
}

export default function TeamPicker({
  available,
  currentPick,
  onPick,
  locked,
}: TeamPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPlacement, setMenuPlacement] = useState<{
    up: boolean
    alignRight: boolean
  }>({
    up: false,
    alignRight: false,
  })
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // Menu dimensions roughly match CSS (max-height 240 + search ~36 + padding)
      const menuHeight = 300
      const menuMinWidth = 200
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const spaceRight = window.innerWidth - rect.left
      setMenuPlacement({
        up: spaceBelow < menuHeight && spaceAbove > spaceBelow,
        alignRight: spaceRight < menuMinWidth,
      })
    }
    setOpen((v) => !v)
  }

  // The set of teams we could show for lock display
  const allOptions: Team[] =
    available.kind === 'all'
      ? [...available.grouped.values()].flat()
      : available.kind === 'waiting'
        ? []
        : available.teams

  const picked = allOptions.find((t) => t.id === currentPick)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (locked) {
    return (
      <div className={styles.pickerLocked}>
        {picked ? (
          <TeamBadge short={picked.short_name} logo={picked.logo_url} />
        ) : (
          <span className={styles.pickerTbd}>—</span>
        )}
        <span className={styles.lockIcon}>🔒</span>
      </div>
    )
  }

  // Waiting: previous round not filled yet
  if (available.kind === 'waiting') {
    return (
      <div className={styles.pickerWaiting}>
        Escolha os times da rodada anterior primeiro
      </div>
    )
  }

  // Duel buttons: match teams OR cascade picks (1 or 2 teams)
  if (available.kind === 'match' || available.kind === 'cascade') {
    return (
      <div className={styles.pickerDuel}>
        {available.teams.map((t) => (
          <button
            key={t.id}
            className={`${styles.pickerDuelBtn} ${currentPick === t.id ? styles.pickerDuelBtnActive : ''}`}
            onClick={() => onPick(t.id)}
          >
            <TeamBadge short={t.short_name} logo={t.logo_url} />
          </button>
        ))}
      </div>
    )
  }

  // All teams: searchable grouped dropdown
  const allFlat =
    available.kind === 'all' ? [...available.grouped.values()].flat() : []
  const filtered =
    query.trim() === ''
      ? null // show grouped
      : allFlat.filter(
          (t) =>
            t.name.toLowerCase().includes(query.toLowerCase()) ||
            t.short_name.toLowerCase().includes(query.toLowerCase()),
        )

  return (
    <div className={styles.pickerDropdown} ref={ref}>
      <button
        ref={triggerRef}
        className={`${styles.pickerTrigger} ${picked ? styles.pickerTriggerPicked : ''}`}
        onClick={toggleOpen}
      >
        {picked ? (
          <TeamBadge short={picked.short_name} logo={picked.logo_url} />
        ) : (
          <span className={styles.pickerPlaceholder}>Escolher time...</span>
        )}
        <span className={styles.pickerChevron}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          className={`${styles.pickerMenu} ${menuPlacement.up ? styles.pickerMenuUp : ''} ${
            menuPlacement.alignRight ? styles.pickerMenuRight : ''
          }`}
        >
          <input
            autoFocus
            id="team-picker-search"
            name="team-picker-search"
            className={styles.pickerSearch}
            placeholder="Buscar time..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className={styles.pickerList}>
            {filtered
              ? filtered.map((t) => (
                  <li key={t.id}>
                    <button
                      className={`${styles.pickerOption} ${currentPick === t.id ? styles.pickerOptionActive : ''}`}
                      onClick={() => {
                        onPick(t.id)
                        setOpen(false)
                        setQuery('')
                      }}
                    >
                      <TeamBadge short={t.short_name} logo={t.logo_url} />
                      <span className={styles.pickerOptionName}>{t.name}</span>
                    </button>
                  </li>
                ))
              : [...available.grouped.entries()].map(([group, teams]) => (
                  <li key={group}>
                    <div className={styles.pickerGroupLabel}>Grupo {group}</div>
                    <ul className={styles.pickerGroupList}>
                      {teams.map((t) => (
                        <li key={t.id}>
                          <button
                            className={`${styles.pickerOption} ${currentPick === t.id ? styles.pickerOptionActive : ''}`}
                            onClick={() => {
                              onPick(t.id)
                              setOpen(false)
                              setQuery('')
                            }}
                          >
                            <TeamBadge short={t.short_name} logo={t.logo_url} />
                            <span className={styles.pickerOptionName}>
                              {t.name}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            {filtered && filtered.length === 0 && (
              <li className={styles.pickerEmpty}>Nenhum time encontrado</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
