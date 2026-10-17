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
  currentPointsClassified?: number
  onPointsClassifiedChanged?: (points: number) => void | Promise<void>
  onRenamed: (newName: string) => void
}

export function RenameGroupModal({
  isOpen,
  onClose,
  groupId,
  currentName,
  onRenamed,
  currentPointsClassified,
  onPointsClassifiedChanged,
}: RenameGroupModalProps) {
  const [pointsClassified, setPointsClassified] = useState(currentPointsClassified ?? 0)
  const [renameValue, setRenameValue] = useState(currentName)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setRenameValue(currentName)
      setPointsClassified(currentPointsClassified ?? 0)
      setRenameError(null)
    }
  }, [isOpen, currentName, currentPointsClassified])

  async function submitRename(event: React.FormEvent) {
    event.preventDefault()

    const name = renameValue.trim()
    if (name.length < 2 || name.length > 30) {
      setRenameError('Nome deve ter entre 2 e 30 caracteres')
      return
    }

    if (!Number.isInteger(pointsClassified) || pointsClassified < 0 || pointsClassified > 10) {
      setRenameError('Pontos de classificado devem ser um inteiro entre 0 e 10')
      return
    }

    setRenaming(true)
    setRenameError(null)

    try {
      const res = await apiFetch(`${config.apiUrl}/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(currentPointsClassified !== undefined && currentPointsClassified !== pointsClassified
            ? { points_classified: pointsClassified }
            : {}),
        }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao renomear grupo')
      }

      trackEvent('submit_renomear_grupo')
      invalidateApiCache('groups:')
      onRenamed(name)
      if (currentPointsClassified !== undefined && currentPointsClassified !== pointsClassified) {
        invalidateApiCache()
        await onPointsClassifiedChanged?.(pointsClassified)
      }
      onClose()
    } catch (e: unknown) {
      setRenameError(e instanceof Error ? e.message : 'Erro ao renomear grupo')
    } finally {
      setRenaming(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={currentPointsClassified === undefined ? 'Editar nome do grupo' : 'Configurar grupo'}
    >
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
        {currentPointsClassified !== undefined && (
          <>
            <label htmlFor="edit-points-classified">Bônus classificado</label>
            <input
              id="edit-points-classified"
              className={styles.renameInput}
              type="number"
              min={0}
              max={10}
              step={1}
              value={pointsClassified}
              onChange={(e) => setPointsClassified(Number(e.target.value))}
            />
            <p>
              Por acertar quem avança no jogo decisivo. Em ida e volta, considera seus dois
              palpites. 0 desliga. Alterar este valor recalcula os pontos dos jogos já encerrados.
            </p>
          </>
        )}
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
