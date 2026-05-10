import { useEffect, useState } from 'react'
import { config } from '../config'
import Button from './Button'
import Modal from './Modal'
import styles from './CreateGroupModal.module.css'

interface Competition {
  id: string
  name: string
  slug: string
  season: string | null
  status: string
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

export default function CreateGroupModal({
  isOpen,
  onClose,
  onCreated,
}: CreateGroupModalProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loadingCompetitions, setLoadingCompetitions] = useState(false)

  const [name, setName] = useState('')
  const [competitionId, setCompetitionId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [created, setCreated] = useState<CreatedGroup | null>(null)
  const [copied, setCopied] = useState(false)

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
    setError(null)
    setCreated(null)
    setCopied(false)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCopyLink(invite_code: string) {
    await navigator.clipboard.writeText(getShareLink(invite_code))
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
