import { trackEvent } from '../../analytics/ga'
import Modal from '../Modal'
import RoundHeader from '../RoundHeader/RoundHeader'
import styles from './LeaderboardTab.module.css'
import type { Member, UserPrediction } from './types'
import { useMemberPredictions } from './hooks/useMemberPredictions'
import { PredictionItem } from './components/PredictionItem'

interface PredictionsModalProps {
  member: Member
  groupId: string
  onClose: () => void
}

export function groupedByGroupName(ms: UserPrediction[]): [string | null, UserPrediction[]][] {
  const result: [string | null, UserPrediction[]][] = []

  if (ms.length === 0) return result

  let currentGroup = ms[0].group_name ?? null
  let currentArray = [ms[0]]
  result.push([currentGroup, currentArray])

  for (let i = 1; i < ms.length; i++) {
    const m = ms[i]
    const key = m.group_name ?? null
    if (key === currentGroup) {
      currentArray.push(m)
    } else {
      currentGroup = key
      currentArray = [m]
      result.push([currentGroup, currentArray])
    }
  }
  return result
}

export default function PredictionsModal({ member, groupId, onClose }: PredictionsModalProps) {
  const { modalPredictions, modalLoading, modalError, modalRoundIndex, setModalRoundIndex } =
    useMemberPredictions(groupId, member.user_id)

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
                    {matches.map((p) => (
                      <PredictionItem key={p.match_id} prediction={p} />
                    ))}
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
