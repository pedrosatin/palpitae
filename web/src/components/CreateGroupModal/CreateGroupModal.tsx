import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import Button from '../Button'
import Modal from '../Modal'
import styles from './CreateGroupModal.module.css'

interface Competition {
  id: string
  name: string
  slug: string
  season: string | null
  status: string
  /** True when the competition has knockout phases that decide on penalties. */
  has_penalty_phases?: boolean
}

interface CreatedGroup {
  id: string
  name: string
  invite_code: string
}

interface CreateGroupModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (group: CreatedGroup) => void
}

type ScoringPreset = 'classic' | 'exact_only' | 'winner_only' | 'custom'

const PRESET_VALUES: Record<
  Exclude<ScoringPreset, 'custom'>,
  { exact: number; winner: number; penalty: number }
> = {
  // penalty = 1 em todos os presets (bônus aditivo, independente do placar exato).
  classic: { exact: 3, winner: 1, penalty: 1 },
  exact_only: { exact: 3, winner: 0, penalty: 1 },
  // "Só vencedor": sem bônus por placar exato (points_exact = 0). Ativa a UI 1X2
  // (Casa / Empate / Fora) no palpite.
  winner_only: { exact: 0, winner: 1, penalty: 1 },
}

const SCORING_HELP_TEXT: Record<'exact' | 'winner', string> = {
  exact: 'Placar exato: pontos para quem crava o placar da partida (ex.: 2 a 1).',
  winner:
    'Vencedor: pontos para quem acerta só o resultado — mandante, visitante ou empate — sem cravar o placar.',
}

function InfoGlyph() {
  return (
    <svg
      className={styles.infoSvg}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
      <path
        d="M8 7.4v3.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

const PRESET_LABELS: Record<ScoringPreset, string> = {
  classic: 'Clássico',
  exact_only: 'Só placar exato',
  winner_only: 'Só vencedor',
  custom: 'Personalizado',
}

export default function CreateGroupModal({
  isOpen,
  onClose,
  onCreated,
}: CreateGroupModalProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loadingCompetitions, setLoadingCompetitions] = useState(false)

  const [name, setName] = useState('')
  const [competitionId, setCompetitionId] = useState('')
  const [scoringPreset, setScoringPreset] = useState<ScoringPreset>('classic')
  const [pointsExact, setPointsExact] = useState(3)
  const [pointsWinner, setPointsWinner] = useState(1)
  const [pointsPenalty, setPointsPenalty] = useState(1)
  const [predictionsVisibility, setPredictionsVisibility] = useState<
    'hidden' | 'public'
  >('hidden')
  const [scoringHelp, setScoringHelp] = useState<'exact' | 'winner' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [created, setCreated] = useState<CreatedGroup | null>(null)
  const [copied, setCopied] = useState(false)

  // Bônus de pênalti só aparece quando a competição escolhida tem fases que vão a
  // pênalti em jogo único (Decisão 4) — senão o campo não faz sentido.
  const showPenaltyField = competitions.find((c) => c.id === competitionId)
    ?.has_penalty_phases === true

  useEffect(() => {
    if (!isOpen || competitions.length > 0) return
    setLoadingCompetitions(true)
    fetch(`${config.apiUrl}/competitions`)
      .then((r) => r.json() as Promise<{ competitions: Competition[] }>)
      .then((data) => {
        setCompetitions(data.competitions)
        if (data.competitions.length > 0) {
          setCompetitionId(data.competitions[0].id)
        }
      })
      .catch(() => setError('Não foi possível carregar as competições'))
      .finally(() => setLoadingCompetitions(false))
  }, [isOpen, competitions.length])

  function reset() {
    setName('')
    setCompetitionId(competitions[0]?.id ?? '')
    setScoringPreset('classic')
    setPointsExact(3)
    setPointsWinner(1)
    setPointsPenalty(1)
    setPredictionsVisibility('hidden')
    setScoringHelp(null)
    setError(null)
    setCreated(null)
    setCopied(false)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handlePreset(preset: ScoringPreset) {
    trackEvent('click_create_group_preset_selecionado', { preset })
    setScoringPreset(preset)
    if (preset !== 'custom') {
      setPointsExact(PRESET_VALUES[preset].exact)
      setPointsWinner(PRESET_VALUES[preset].winner)
      setPointsPenalty(PRESET_VALUES[preset].penalty)
    }
  }

  function toggleScoringHelp(field: 'exact' | 'winner') {
    trackEvent('click_create_group_ajuda_pontuacao', { campo: field })
    setScoringHelp((cur) => (cur === field ? null : field))
  }

  function handleVisibility(visibility: 'hidden' | 'public') {
    trackEvent(
      visibility === 'public'
        ? 'click_create_group_visibilidade_publica'
        : 'click_create_group_visibilidade_oculta',
    )
    setPredictionsVisibility(visibility)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (pointsExact > 0 && pointsExact < pointsWinner) {
      setError(
        'Pontos por placar exato deve ser maior ou igual a pontos por vencedor',
      )
      return
    }
    if (pointsExact + pointsWinner === 0) {
      setError('Pelo menos um tipo de pontuação deve ser maior que zero')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch(`${config.apiUrl}/groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          competition_id: competitionId,
          points_exact: pointsExact,
          points_winner: pointsWinner,
          points_penalty: showPenaltyField ? pointsPenalty : 1,
          predictions_visibility: predictionsVisibility,
        }),
      })

      const data = (await res.json()) as {
        group?: CreatedGroup
        error?: string
      }

      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar grupo')
        return
      }

      trackEvent('submit_criar_grupo')
      setCreated(data.group!)
      onCreated(data.group!)
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  function getShareLink(invite_code: string) {
    return `${window.location.origin}?convite=${invite_code}`
  }

  async function handleCopyCode(invite_code: string) {
    await navigator.clipboard.writeText(invite_code)
    trackEvent('click_create_group_copiar_codigo')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCopyLink(invite_code: string) {
    await navigator.clipboard.writeText(getShareLink(invite_code))
    trackEvent('click_create_group_copiar_link')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Criar grupo">
      {created ? (
        <div className={styles.success}>
          <div className={styles.successIcon}>🎉</div>
          <h3 className={styles.successTitle}>Grupo criado!</h3>
          <p className={styles.successName}>{created.name}</p>
          <p className={styles.inviteLabel}>
            Compartilhe o código com seus amigos:
          </p>

          <div className={styles.codeBox}>
            <span className={styles.code}>{created.invite_code}</span>
            <button
              className={styles.copyBtn}
              onClick={() => handleCopyCode(created.invite_code)}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>

          <div className={styles.linkRow}>
            <span className={styles.linkText}>
              {getShareLink(created.invite_code)}
            </span>
            <button
              className={styles.copyBtn}
              onClick={() => handleCopyLink(created.invite_code)}
            >
              {copied ? 'Copiado!' : 'Copiar link'}
            </button>
          </div>

          <Button
            variant="primary"
            className={styles.doneBtn}
            onClick={handleClose}
          >
            Pronto
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="group-name">
              Nome do grupo
            </label>
            <input
              id="group-name"
              className={styles.input}
              type="text"
              placeholder="Ex: Os Craques do Bairro"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="group-competition">
              Competição
            </label>
            {loadingCompetitions ? (
              <p className={styles.loadingText}>Carregando competições...</p>
            ) : competitions.length === 0 ? (
              <p className={styles.emptyText}>
                Nenhuma competição disponível no momento.
              </p>
            ) : (
              <select
                id="group-competition"
                className={styles.select}
                value={competitionId}
                onChange={(e) => setCompetitionId(e.target.value)}
                required
              >
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.season ? ` ${c.season}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Regras de pontuação</span>
            <div className={styles.presetGrid}>
              {(
                ['classic', 'exact_only', 'winner_only', 'custom'] as ScoringPreset[]
              ).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`${styles.presetBtn} ${scoringPreset === preset ? styles.presetBtnActive : ''}`}
                  onClick={() => handlePreset(preset)}
                  aria-pressed={scoringPreset === preset}
                >
                  {PRESET_LABELS[preset]}
                </button>
              ))}
            </div>
            <div className={styles.pointsRow}>
              <div className={styles.pointsField}>
                <label className={styles.pointsLabel} htmlFor="points-exact">
                  Placar exato
                  <button
                    type="button"
                    className={styles.infoIcon}
                    aria-label="O que é placar exato?"
                    aria-expanded={scoringHelp === 'exact'}
                    onClick={(e) => {
                      e.preventDefault()
                      toggleScoringHelp('exact')
                    }}
                  >
                    <InfoGlyph />
                  </button>
                </label>
                <input
                  id="points-exact"
                  className={styles.pointsInput}
                  type="number"
                  min={0}
                  max={10}
                  value={pointsExact}
                  disabled={scoringPreset !== 'custom'}
                  onChange={(e) =>
                    setPointsExact(Math.max(0, Math.min(10, Math.floor(Number(e.target.value)))))
                  }
                />
              </div>
              <div className={styles.pointsField}>
                <label className={styles.pointsLabel} htmlFor="points-winner">
                  Vencedor
                  <button
                    type="button"
                    className={styles.infoIcon}
                    aria-label="O que é vencedor?"
                    aria-expanded={scoringHelp === 'winner'}
                    onClick={(e) => {
                      e.preventDefault()
                      toggleScoringHelp('winner')
                    }}
                  >
                    <InfoGlyph />
                  </button>
                </label>
                <input
                  id="points-winner"
                  className={styles.pointsInput}
                  type="number"
                  min={0}
                  max={10}
                  value={pointsWinner}
                  disabled={scoringPreset !== 'custom'}
                  onChange={(e) =>
                    setPointsWinner(Math.max(0, Math.min(10, Math.floor(Number(e.target.value)))))
                  }
                />
              </div>
            </div>
            {showPenaltyField && (
              <div className={styles.pointsRow}>
                <div className={styles.pointsField}>
                  <label className={styles.pointsLabel} htmlFor="points-penalty">
                    Bônus pênalti
                  </label>
                  <input
                    id="points-penalty"
                    className={styles.pointsInput}
                    type="number"
                    min={0}
                    max={10}
                    value={pointsPenalty}
                    disabled={scoringPreset !== 'custom'}
                    onChange={(e) =>
                      setPointsPenalty(Math.max(0, Math.min(10, Math.floor(Number(e.target.value)))))
                    }
                  />
                </div>
                <p className={styles.penaltyHint}>
                  Pontos extras por acertar quem vence nos pênaltis num palpite de
                  empate. 0 desliga.
                </p>
              </div>
            )}
            {scoringHelp && (
              <p className={styles.scoringHelp} role="note">
                {SCORING_HELP_TEXT[scoringHelp]}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Visibilidade dos palpites</span>
            <div className={styles.visibilityGroup}>
              <button
                type="button"
                className={`${styles.visibilityOption} ${predictionsVisibility === 'hidden' ? styles.visibilityOptionActive : ''}`}
                onClick={() => handleVisibility('hidden')}
                aria-pressed={predictionsVisibility === 'hidden'}
              >
                <span className={styles.visibilityTitle}>Oculto até palpitar</span>
                <span className={styles.visibilityDesc}>
                  Outros palpites só aparecem depois que você palpitar ou o jogo
                  começar
                </span>
              </button>
              <button
                type="button"
                className={`${styles.visibilityOption} ${predictionsVisibility === 'public' ? styles.visibilityOptionActive : ''}`}
                onClick={() => handleVisibility('public')}
                aria-pressed={predictionsVisibility === 'public'}
              >
                <span className={styles.visibilityTitle}>Sempre visível</span>
                <span className={styles.visibilityDesc}>
                  Todos veem os palpites em tempo real
                </span>
              </button>
            </div>
          </div>

          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || !name.trim() || !competitionId}
            >
              {submitting ? 'Criando...' : 'Criar grupo'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
