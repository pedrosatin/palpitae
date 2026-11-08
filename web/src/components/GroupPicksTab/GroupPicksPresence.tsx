import { useState } from 'react'
import { trackEvent } from '../../analytics/ga'
import {
  buildReminderMessage,
  joinNames,
  memberInitials,
  missingLabel,
  pickersCountLabel,
  type GroupMember,
  type RoundReminder,
} from '../../lib/groupReminder'
import { predictionsPath } from '../../lib/rounds'
import { WhatsAppShareButton } from '../ShareButtons'
import styles from './GroupPicksTab.module.css'

/** Círculos por card. Acima disso aparece só o total restante. */
const MAX_INITIALS = 12

/**
 * Quem já palpitou um jogo aberto. As iniciais identificam a pessoa pelo `title` no
 * mouse, e o toque abre os nomes por extenso, porque o celular não mostra `title`.
 * Sem `showInitials` fica só a contagem. No grupo "Sempre visível" a lista do card já
 * diz quem palpitou.
 */
export function MatchPickers({
  pickers,
  memberCount,
  selfUserId,
  showInitials,
}: {
  pickers: GroupMember[]
  memberCount: number
  selfUserId: string
  showInitials: boolean
}) {
  const [namesOpen, setNamesOpen] = useState(false)
  const count = pickersCountLabel(pickers.length, memberCount)

  if (!showInitials || pickers.length === 0) {
    return <p className={styles.pickersCount}>{count}</p>
  }

  const names = joinNames(pickers.map((m) => (m.user_id === selfUserId ? 'você' : m.display)))
  const extra = pickers.length - MAX_INITIALS

  function toggleNames() {
    trackEvent('click_group_picks_ver_quem_palpitou', { open: !namesOpen })
    setNamesOpen((open) => !open)
  }

  return (
    <div className={styles.pickers}>
      <button
        type="button"
        className={styles.pickersToggle}
        aria-expanded={namesOpen}
        aria-label={`${count}. ${names}`}
        onClick={toggleNames}
      >
        <span className={styles.pickersCount}>{count}</span>
        <span className={styles.initials} aria-hidden="true">
          {pickers.slice(0, MAX_INITIALS).map((m) => (
            <span
              key={m.user_id}
              className={`${styles.initial} ${m.user_id === selfUserId ? styles.initialSelf : ''}`}
              title={m.display}
            >
              {memberInitials(m.display)}
            </span>
          ))}
          {extra > 0 && <span className={styles.initial}>+{extra}</span>}
        </span>
      </button>
      {namesOpen && <p className={styles.pickersNames}>{names}</p>}
    </div>
  )
}

/**
 * Resumo da rodada no topo da aba Grupo. O botão de lembrete aparece para qualquer
 * membro, admin ou não, tenha ou não palpitado. Ele só some quando a única pessoa
 * faltando é quem está vendo.
 */
export function RoundReminderSummary({
  reminder,
  selfUserId,
  groupId,
  groupName,
  round,
  roundLabel,
}: {
  reminder: RoundReminder
  selfUserId: string
  groupId: string
  groupName: string
  round: string
  roundLabel: string
}) {
  const { missing, deadline } = reminder

  if (missing.length === 0) {
    return (
      <p className={styles.summaryText}>
        Todo mundo palpitou <span aria-hidden="true">✓</span>
      </p>
    )
  }

  const canRemind = deadline !== null && missing.some((m) => m.user_id !== selfUserId)
  const link = `${window.location.origin}${predictionsPath(groupId, round)}`

  return (
    <div className={styles.reminderRow}>
      <p className={styles.summaryText}>{missingLabel(missing, selfUserId)}</p>
      {canRemind && (
        <WhatsAppShareButton
          label="Lembrar no WhatsApp"
          eventContext="group_picks_lembrete"
          shareLink={link}
          message={buildReminderMessage({
            roundLabel,
            groupName,
            missing: missing.map((m) => m.display),
            deadline,
            link,
          })}
        />
      )}
    </div>
  )
}
