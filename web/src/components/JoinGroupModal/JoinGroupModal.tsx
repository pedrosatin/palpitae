import { useEffect, useRef, useState } from 'react'
import { buildApiUrl } from '../../config'
import { type JoinGroupEntryMethod, trackJoinGroup } from '../../analytics/funnel'
import { trackEvent } from '../../analytics/ga'
import { apiFetch, CONNECTION_ERROR, readApiError } from '../../lib/api'
import { parseInviteCode, forgetInviteDocument, wasInviteDocumentOpened } from '../../lib/invite'
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
  /** Envia `initialCode` assim que o modal abre, uma única vez. */
  autoSubmit?: boolean
}

/** Só quem abriu `/convite/<código>` passou pela página que conta aberturas. */
function joinEntryMethod(fromLink: boolean, inviteCode: string): JoinGroupEntryMethod {
  if (!fromLink) return 'codigo'
  return wasInviteDocumentOpened(inviteCode) ? 'convite_link' : 'convite_antigo'
}

export default function JoinGroupModal({
  isOpen,
  onClose,
  onJoined,
  initialCode = '',
  autoSubmit = false,
}: JoinGroupModalProps) {
  const [code, setCode] = useState(initialCode)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<JoinedGroup | null>(null)
  const autoSubmitted = useRef(false)

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

  async function submitCode(rawCode: string) {
    setError(null)
    setSubmitting(true)

    const invite_code = parseInviteCode(rawCode)
    // Veio pelo link quando o código enviado é o mesmo que chegou na URL;
    // se o usuário apagou e digitou outro, conta como código.
    const fromLink = initialCode !== '' && parseInviteCode(initialCode) === invite_code
    const entry_method = joinEntryMethod(fromLink, invite_code)

    try {
      const res = await apiFetch(buildApiUrl('/groups/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code, entry_method }),
      })

      if (!res.ok) {
        setError(await readApiError(res, 'Erro ao entrar no grupo'))
        return
      }
      const data = (await res.json()) as { group?: JoinedGroup }

      trackEvent('submit_entrar_grupo')
      trackJoinGroup(entry_method)
      if (entry_method === 'convite_link') forgetInviteDocument()
      setJoined(data.group!)
      onJoined(data.group!)
    } catch {
      setError(CONNECTION_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void submitCode(code)
  }

  useEffect(() => {
    if (!isOpen || !autoSubmit || autoSubmitted.current) return
    autoSubmitted.current = true
    void submitCode(initialCode)
  }, [isOpen, autoSubmit])

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
