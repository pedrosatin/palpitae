import { useState, useEffect } from 'react'
import Modal from '../../components/Modal'
import Button from '../../components/Button'
import { apiFetch } from '../../lib/api'
import { config } from '../../config'
import { invalidateApiCache } from '../../lib/api-cache'
import { trackEvent } from '../../analytics/ga'
import styles from './GroupDetailPage.module.css'

interface RenameGroupModalProps {
  isOpen: boolean
  onClose: () => void
  groupId: string
  currentName: string
  onRenamed: (newName: string) => void
}

export function RenameGroupModal({
  isOpen,
  onClose,
  groupId,
  currentName,
  onRenamed,
}: RenameGroupModalProps) {
  const [renameValue, setRenameValue] = useState(currentName)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setRenameValue(currentName)
      setRenameError(null)
    }
  }, [isOpen, currentName])

  async function submitRename(event: React.FormEvent) {
    event.preventDefault()

    const name = renameValue.trim()
    if (name.length < 2 || name.length > 50) {
      setRenameError('Nome deve ter entre 2 e 50 caracteres')
      return
    }

    setRenaming(true)
    setRenameError(null)

    try {
      const res = await apiFetch(`${config.apiUrl}/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao renomear grupo')
      }

      trackEvent('submit_renomear_grupo')
      invalidateApiCache('groups:')
      onRenamed(name)
      onClose()
    } catch (e: unknown) {
      setRenameError(e instanceof Error ? e.message : 'Erro ao renomear grupo')
    } finally {
      setRenaming(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar nome do grupo">
      <form onSubmit={submitRename} className={styles.renameForm}>
        <input
          className={styles.renameInput}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          maxLength={30}
          placeholder="Nome do grupo"
          autoFocus
        />
        {renameError && <p className={styles.renameError}>{renameError}</p>}
        <div className={styles.renameActions}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={renaming}>
            {renaming ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default RenameGroupModal
