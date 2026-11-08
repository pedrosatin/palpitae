import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import type { GroupMember } from '../../lib/groupReminder'
import {
  highlightText,
  pointsLabel,
  postponedNotice,
  rankRound,
  roundLeaders,
  roundScope,
  tallyRound,
  type GroupRoundPick,
} from '../../lib/roundSummary'
import {
  buildRoundShareCardData,
  renderRoundShareCardBlob,
  roundShareFileName,
  roundShareText,
} from '../../lib/roundShareCard'
import { shareOrDownloadImage } from '../../lib/shareImage'
import Button from '../Button'
import type { Match, Prediction } from '../MatchCard'
import styles from './RoundSummary.module.css'

interface GroupRoundData {
  /** Jogos encerrados para os quais a resposta foi pedida. */
  key: string
  selfUserId: string
  members: GroupMember[]
  picks: GroupRoundPick[]
}

interface RoundSummaryProps {
  groupId: string
  groupName?: string
  roundLabel: string
  roundMatches: Match[]
  /** Palpites do próprio usuário, os mesmos dos chips dos cards. */
  predictions: Map<string, Prediction>
  pointsExact: number
}

/**
 * Palpites do grupo para a classificação da rodada. É a mesma chamada da aba Grupo, sem
 * rota nova. Nos dois modos de visibilidade, a API só entrega palpite alheio de jogo
 * travado, e o resumo só usa jogo encerrado. Falha de rede deixa `null`, e o resumo
 * segue só com os dados do próprio usuário.
 */
function useGroupRoundData(groupId: string, enabled: boolean, finishedKey: string) {
  const [data, setData] = useState<GroupRoundData | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    apiFetch(`${config.apiUrl}/predictions/group?group_id=${encodeURIComponent(groupId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('falha')
        const body = (await res.json()) as {
          self_user_id?: string
          members?: GroupMember[]
          predictions?: GroupRoundPick[]
        }
        if (
          !body.self_user_id ||
          !Array.isArray(body.members) ||
          !Array.isArray(body.predictions)
        ) {
          throw new Error('resposta sem membros')
        }
        if (active) {
          setData({
            key: finishedKey,
            selfUserId: body.self_user_id,
            members: body.members,
            picks: body.predictions,
          })
        }
      })
      .catch(() => {
        if (active) setData(null)
      })
    return () => {
      active = false
    }
  }, [groupId, enabled, finishedKey])

  // Resposta de outra rodada não vale: mostraria zeros até a nova chegar.
  return data?.key === finishedKey ? data : null
}

/**
 * Resumo da rodada encerrada, no topo da aba Palpitar. Só aparece com todos os jogos
 * encerrados, ou encerrados e adiados (resumo parcial). Os números do próprio usuário
 * saem dos palpites já carregados. A colocação, o destaque e o cartão esperam os
 * palpites do grupo.
 */
export default function RoundSummary({
  groupId,
  groupName,
  roundLabel,
  roundMatches,
  predictions,
  pointsExact,
}: RoundSummaryProps) {
  const scope = roundScope(roundMatches)
  const finishedKey = scope ? scope.finished.map((m) => m.id).join(',') : ''
  const groupData = useGroupRoundData(groupId, scope !== null, finishedKey)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState(false)

  if (!scope) return null

  const own = tallyRound(scope.finished, [...predictions.values()], pointsExact)
  const standings = groupData
    ? rankRound(
        scope.finished,
        groupData.picks,
        groupData.members,
        groupData.selfUserId,
        pointsExact,
      )
    : null
  const self = standings?.find((s) => s.isYou)
  const highlight = standings ? highlightText(roundLeaders(standings)) : null
  const notice = postponedNotice(scope.postponed)

  async function handleShare() {
    if (!standings || !self) return
    trackEvent('click_resumo_rodada_compartilhar')
    setSharing(true)
    setShareError(false)
    try {
      const data = buildRoundShareCardData({
        groupName: groupName ?? 'Palpitae',
        roundLabel,
        standings,
        self: { ...own, position: self.position },
        postponed: scope!.postponed,
        origin: window.location.origin,
      })
      const blob = await renderRoundShareCardBlob(data)
      if (!blob) {
        setShareError(true)
        return
      }
      await shareOrDownloadImage(blob, roundShareFileName(roundLabel), roundShareText(data))
    } finally {
      setSharing(false)
    }
  }

  return (
    <section className={styles.summary} aria-label="Resumo da rodada">
      <h3 className={styles.title}>Resumo da rodada</h3>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.value}>{own.points}</span>
          <span className={styles.label}>{own.points === 1 ? 'ponto' : 'pontos'}</span>
        </div>
        {pointsExact > 0 && (
          <div className={styles.stat}>
            <span className={styles.value}>{own.exact}</span>
            <span className={styles.label}>
              {own.exact === 1 ? 'placar exato' : 'placares exatos'}
            </span>
          </div>
        )}
        <div className={styles.stat}>
          <span className={styles.value}>{own.correct}</span>
          <span className={styles.label}>
            {own.correct === 1 ? 'resultado certo' : 'resultados certos'}
          </span>
        </div>
      </div>
      {own.missed > 0 && (
        <p className={styles.line}>
          {own.missed === 1 ? '1 jogo ficou' : `${own.missed} jogos ficaram`} sem palpite.
        </p>
      )}
      {self && standings && (
        <p className={styles.line}>
          <strong>
            {self.position}º de {standings.length}
          </strong>{' '}
          no grupo nesta rodada, com {pointsLabel(self.points)}.
        </p>
      )}
      {highlight && <p className={styles.line}>{highlight}.</p>}
      {notice && <p className={styles.notice}>{notice}.</p>}
      {self && standings && (
        <div className={styles.actions}>
          <Button variant="outline" size="sm" onClick={handleShare} disabled={sharing}>
            {sharing ? 'Gerando imagem...' : 'Compartilhar rodada'}
          </Button>
          {shareError && (
            <span className={styles.error} role="alert">
              Não foi possível gerar a imagem neste navegador.
            </span>
          )}
        </div>
      )}
    </section>
  )
}
