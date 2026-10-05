import { useState } from 'react'
import { config } from '../../config'
import { trackJoinGroup } from '../../analytics/funnel'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import { parseInviteCode } from '../../lib/invite'
import Button from '../Button'
import Modal from '../Modal'
import styles from './JoinGroupModal.module.css'
import shared from '../modal-shared.module.css'

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const invite_code = parseInviteCode(code)

    try {
      const res = await apiFetch(`${config.apiUrl}/groups/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code }),
      })

      const data = (await res.json()) as { group?: JoinedGroup; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Erro ao entrar no grupo')
        return
      }

      trackEvent('submit_entrar_grupo')
      // Veio pelo link quando o código enviado é o mesmo que chegou na URL;
      // se o usuário apagou e digitou outro, conta como código.
      const fromLink = initialCode !== '' && parseInviteCode(initialCode) === invite_code
      trackJoinGroup(fromLink ? 'convite_link' : 'codigo', data.group!.id)
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
        <SuccessView joined={joined} onClose={handleClose} />
      ) : (
        <FormView
          code={code}
          setCode={setCode}
          submitting={submitting}
          error={error}
          onSubmit={handleSubmit}
          onCancel={handleClose}
        />
      )}
    </Modal>
  )
}

function SuccessView({ joined, onClose }: { joined: JoinedGroup; onClose: () => void }) {
  return (
    <div className={shared.success}>
      <div className={shared.successIcon}>🏆</div>
      <h3 className={shared.successTitle}>Você entrou no grupo!</h3>
      <p className={shared.successName}>{joined.name}</p>
      <Button variant="primary" className={styles.doneBtn} onClick={onClose}>
        Ir para o grupo
      </Button>
    </div>
  )
}

interface FormViewProps {
  code: string
  setCode: (val: string) => void
  submitting: boolean
  error: string | null
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

function FormView({ code, setCode, submitting, error, onSubmit, onCancel }: FormViewProps) {
  return (
    <form onSubmit={onSubmit} className={shared.form}>
      <p className={styles.hint}>
        Cole o código de convite ou o link compartilhado pelo administrador do grupo.
      </p>

      {error && <p className={shared.error}>{error}</p>}

      <div className={shared.field}>
        <label className={shared.label} htmlFor="invite-code">
          Código ou link de convite
        </label>
        <input
          id="invite-code"
          className={shared.input}
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

      <div className={shared.actions}>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={submitting || !code.trim()}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </Button>
      </div>
    </form>
  )
}
