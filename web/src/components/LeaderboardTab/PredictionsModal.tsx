import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { applyDefaultRound } from '../../lib/rounds'
import Modal from '../Modal'
import RoundHeader from '../RoundHeader/RoundHeader'
import styles from './LeaderboardTab.module.css'
import type { Member, UserPrediction } from './types'

interface PredictionsModalProps {
  member: Member
  groupId: string
  onClose: () => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function groupedByGroupName(ms: UserPrediction[]): [string | null, UserPrediction[]][] {
  const result: [string | null, UserPrediction[]][] = []
  for (const m of ms) {
    const key = m.group_name ?? null
    const last = result[result.length - 1]
    if (last && last[0] === key) {
      last[1].push(m)
    } else {
      result.push([key, [m]])
    }
  }
  return result
}

export default function PredictionsModal({ member, groupId, onClose }: PredictionsModalProps) {
  const [modalPredictions, setModalPredictions] = useState<UserPrediction[]>([])
  const [modalLoading, setModalLoading] = useState(true)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalRoundIndex, setModalRoundIndex] = useState(0)

  useEffect(() => {
    let mounted = true
    setModalLoading(true)
    setModalError(null)

    apiFetch(
      `${config.apiUrl}/predictions/user?group_id=${encodeURIComponent(groupId)}&user_id=${encodeURIComponent(member.user_id)}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar palpites')
        return r.json() as Promise<{
          predictions: UserPrediction[]
          default_round: string | null
        }>
      })
      .then((data) => {
        if (!mounted) return
        setModalPredictions(data.predictions)
        const keys = [...new Set(data.predictions.map((p) => p.round))]
        applyDefaultRound(data.default_round, keys, setModalRoundIndex)
      })
      .catch((e: Error) => {
        if (!mounted) return
        setModalError(e.message)
      })
      .finally(() => {
        if (!mounted) return
        setModalLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [groupId, member.user_id])

  const modalByRound = new Map<string, UserPrediction[]>()
  for (const p of modalPredictions) {
    if (!modalByRound.has(p.round)) modalByRound.set(p.round, [])
    modalByRound.get(p.round)!.push(p)
  }
  const modalRoundKeys = Array.from(modalByRound.keys())
  const safeModalIndex = Math.min(modalRoundIndex, Math.max(0, modalRoundKeys.length - 1))
  const selectedModalRound = modalRoundKeys[safeModalIndex]

  const labelFor = (r: string) => modalByRound.get(r)?.[0]?.round_label ?? r

  return (
    <Modal isOpen={true} onClose={onClose} title={`Palpites de ${member.display_name}`}>
      {modalLoading && <p className={styles.modalLoading}>Carregando palpites...</p>}
      {modalError && <p className={styles.modalError}>{modalError}</p>}
      {!modalLoading && !modalError && modalPredictions.length === 0 && (
        <p className={styles.modalEmpty}>Nenhum jogo encontrado.</p>
      )}
      {!modalLoading && !modalError && modalPredictions.length > 0 && (
        <>
          <RoundHeader
            id="leaderboard-round-select"
            className={styles.modalRoundNav}
            roundKeys={modalRoundKeys}
            safeIndex={safeModalIndex}
            selectedRound={selectedModalRound}
            labelFor={labelFor}
            onPrev={() => {
              trackEvent('click_leaderboard_rodada_anterior', {
                round: modalRoundKeys[Math.max(0, safeModalIndex - 1)],
              })
              setModalRoundIndex((i) => Math.max(0, i - 1))
            }}
            onNext={() => {
              trackEvent('click_leaderboard_proxima_rodada', {
                round: modalRoundKeys[Math.min(modalRoundKeys.length - 1, safeModalIndex + 1)],
              })
              setModalRoundIndex((i) => Math.min(modalRoundKeys.length - 1, i + 1))
            }}
            onSelect={(round) => {
              trackEvent('change_leaderboard_rodada', { round })
              setModalRoundIndex(modalRoundKeys.indexOf(round))
            }}
          />
          <div className={styles.predGroups}>
            {groupedByGroupName(modalByRound.get(selectedModalRound) ?? []).map(
              ([groupName, matches]) => (
                <div key={groupName ?? '__no_group'} className={styles.predGroup}>
                  {groupName && <h4 className={styles.predGroupHeader}>Grupo {groupName}</h4>}
                  <ul className={styles.predList}>
                    {matches.map((p) => {
                      const isFinished = p.match_status === 'finished'
                      const hasPrediction = p.predicted_home_score !== null
                      const isScheduled = p.match_status === 'scheduled'
                      return (
                        <li key={p.match_id} className={styles.predItem}>
                          <div className={styles.predMatch}>
                            <span className={styles.predTeam}>
                              <img
                                src={p.home_team_logo}
                                alt={p.home_team_short_name}
                                className={styles.predCrest}
                                loading="lazy"
                              />
                              {p.home_team_short_name}
                            </span>
                            <span className={styles.predVs}>×</span>
                            <span className={`${styles.predTeam} ${styles.predTeamAway}`}>
                              {p.away_team_short_name}
                              <img
                                src={p.away_team_logo}
                                alt={p.away_team_short_name}
                                className={styles.predCrest}
                                loading="lazy"
                              />
                            </span>
                          </div>
                          {hasPrediction ? (
                            <>
                              <div className={styles.predScores}>
                                <span className={styles.predLabel}>Palpite</span>
                                <span className={styles.predScore}>
                                  {p.predicted_home_score} × {p.predicted_away_score}
                                </span>
                                {isFinished && (
                                  <>
                                    <span className={styles.predLabel}>Resultado</span>
                                    <span className={styles.predScore}>
                                      {p.home_score ?? '–'} × {p.away_score ?? '–'}
                                    </span>
                                  </>
                                )}
                              </div>
                              <div className={styles.predMeta}>
                                <span className={styles.predDate}>
                                  {formatDate(p.match_start_time)}
                                </span>
                                {isFinished && (
                                  <span
                                    className={
                                      (p.points_awarded ?? 0) > 0
                                        ? styles.predPointsGreen
                                        : styles.predPointsZero
                                    }
                                  >
                                    {p.points_awarded} pt
                                  </span>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className={styles.predNone}>
                              {isScheduled ? formatDate(p.match_start_time) : 'Sem palpite'}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
