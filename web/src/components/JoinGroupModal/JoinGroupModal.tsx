import { useState } from 'react'
import { config } from '../../config'
import Button from '../Button'
import Modal from '../Modal'
import styles from './JoinGroupModal.module.css'

interface JoinedGroup {
  id: string
  name: string
}

interface JoinGroupModalProps {
  isOpen: boolean
  onClose: () => void
  onJoined: (group: JoinedGroup) => void
  /** Pre-fill the invite code (e.g. from a share link) */
  initialCode?: string
}

export default function JoinGroupModal({
  isOpen,
  onClose,
  onJoined,
  initialCode = '',
}: JoinGroupModalProps) {
  const [code, setCode] = useState(initialCode)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<JoinedGroup | null>(null)

  function reset() {
    setCode(initialCode)
    setError(null)
    setJoined(null)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  /** Normalise the code — strip the share link if someone pastes it */
  function normaliseCode(raw: string): string {
    try {
      const url = new URL(raw)
      const param = url.searchParams.get('convite')
      if (param) return param.toUpperCase()
    } catch {
      // not a URL — fall through
    }
    return raw.trim().toUpperCase()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const invite_code = normaliseCode(code)

    try {
      const res = await fetch(`${config.apiUrl}/groups/join`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code }),
      })

      const data = (await res.json()) as { group?: JoinedGroup; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Erro ao entrar no grupo')
        return
      }

      setJoined(data.group!)
      onJoined(data.group!)
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Entrar em grupo">
      {joined ? (
        <div className={styles.success}>
          <div className={styles.successIcon}>🏆</div>
          <h3 className={styles.successTitle}>Você entrou no grupo!</h3>
          <p className={styles.successName}>{joined.name}</p>
          <Button
            variant="primary"
            className={styles.doneBtn}
            onClick={handleClose}
          >
            Ir para o grupo
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className={styles.form}>
          <p className={styles.hint}>
            Cole o código de convite ou o link compartilhado pelo administrador
            do grupo.
          </p>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="invite-code">
              Código ou link de convite
            </label>
            <input
              id="invite-code"
              className={styles.input}
              type="text"
              placeholder="Ex: ABCD-1234"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
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
              disabled={submitting || !code.trim()}
            >
              {submitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
