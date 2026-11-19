import { useEffect, useState } from 'react'
import { useRoundStandings } from '../../hooks/useRoundStandings'
import { fetchGroupPredictions } from '../../lib/groupPredictions'
import type { GroupMember } from '../../lib/groupReminder'
import {
  EXACT_MILESTONES,
  exactMilestoneHighlightText,
  type ExactMilestone,
} from '../../lib/exactMilestones'
import { buildGroupLink } from '../../lib/groupLink'
import { buildInviteLink } from '../../lib/invite'
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
import type { Match, Prediction } from '../MatchCard'
import { RoundShareActions } from './RoundShareActions'
import { RoundSummaryStats } from './RoundSummaryStats'
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
  /** Rótulo exibido ("Rodada 34"). */
  roundLabel: string
  /** Número da rodada selecionada, para cruzar com a referência da API. */
  selectedRound?: string | null
  roundMatches: Match[]
  /** Palpites do próprio usuário, os mesmos dos chips dos cards. */
  predictions: Map<string, Prediction>
  pointsExact: number
  /** Código de convite, só quando o dono compartilha o marco. */
  inviteCode?: string | null
  /** Identificador público do grupo para o link de pedido de entrada. */
  publicId?: string | null
  /** Dono usa o link de convite; demais membros usam o link público. */
  isOwner?: boolean
}

function asExactMilestones(values: number[] | undefined): ExactMilestone[] {
  if (!values?.length) return []
  const allowed = new Set<number>(EXACT_MILESTONES)
  return values.filter((v): v is ExactMilestone => allowed.has(v))
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
    fetchGroupPredictions<{
      self_user_id?: string
      members?: GroupMember[]
      predictions?: GroupRoundPick[]
    }>(groupId)
      .then((body) => {
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

function groupShareLink(input: {
  isOwner: boolean
  inviteCode?: string | null
  publicId?: string | null
}): string | null {
  if (input.isOwner && input.inviteCode) return buildInviteLink(input.inviteCode)
  if (input.publicId) return buildGroupLink(input.publicId)
  return null
}

interface RoundStandingRow {
  user_id: string
  exact_hits?: number
  exact_milestones_crossed?: number[]
}

/** Marcos cruzados na rodada de referência; vazio fora dela ou sem cruzamento. */
function selfExactCrossing(input: {
  selfUserId: string | undefined
  referenceRound: string | null
  selectedRound: string | null | undefined
  standings: RoundStandingRow[]
}): { crossed: ExactMilestone[]; exactHits: number } {
  if (
    !input.selfUserId ||
    input.referenceRound === null ||
    input.selectedRound !== input.referenceRound
  ) {
    return { crossed: [], exactHits: 0 }
  }
  const row = input.standings.find((s) => s.user_id === input.selfUserId)
  const crossed = asExactMilestones(row?.exact_milestones_crossed)
  const exactHits = row?.exact_hits ?? crossed[crossed.length - 1] ?? 0
  return { crossed, exactHits }
}

/**
 * Resumo da rodada encerrada, no topo da aba Palpitar. Só aparece com todos os jogos
 * encerrados, ou encerrados e adiados (resumo parcial). Os números do próprio usuário
 * saem dos palpites já carregados. A colocação, o destaque e o cartão esperam os
 * palpites do grupo. O marco só destaca quando a rodada selecionada é a referência
 * e a API reporta cruzamento.
 */
export default function RoundSummary({
  groupId,
  groupName,
  roundLabel,
  selectedRound,
  roundMatches,
  predictions,
  pointsExact,
  inviteCode,
  publicId,
  isOwner = false,
}: RoundSummaryProps) {
  const scope = roundScope(roundMatches)
  const finishedKey = scope ? scope.finished.map((m) => m.id).join(',') : ''
  const groupData = useGroupRoundData(groupId, scope !== null, finishedKey)
  const { round: referenceRound, standings: roundStandings } = useRoundStandings(
    groupId,
    scope !== null,
  )

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
  const { crossed, exactHits } = selfExactCrossing({
    selfUserId: groupData?.selfUserId,
    referenceRound,
    selectedRound,
    standings: roundStandings,
  })
  const milestoneHighlight = exactMilestoneHighlightText(crossed)
  const shareLink = groupShareLink({ isOwner, inviteCode, publicId })

  return (
    <section className={styles.summary} aria-label="Resumo da rodada">
      <h3 className={styles.title}>Resumo da rodada</h3>
      <RoundSummaryStats own={own} pointsExact={pointsExact} />
      {self && standings && (
        <p className={styles.line}>
          <strong>
            {self.position}º de {standings.length}
          </strong>{' '}
          no grupo nesta rodada, com {pointsLabel(self.points)}.
        </p>
      )}
      {highlight && <p className={styles.line}>{highlight}.</p>}
      {milestoneHighlight && <p className={styles.milestone}>{milestoneHighlight}.</p>}
      {notice && <p className={styles.notice}>{notice}.</p>}
      <RoundShareActions
        groupName={groupName}
        roundLabel={roundLabel}
        postponed={scope.postponed}
        own={own}
        standings={standings}
        self={self}
        crossed={crossed}
        exactHits={exactHits}
        shareLink={shareLink}
      />
    </section>
  )
}
