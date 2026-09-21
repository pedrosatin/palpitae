import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trackEvent } from '../../analytics/ga'
import Button from '../../components/Button'
import ErrorState from '../../components/ErrorState'
import Header from '../../components/Header'
import Modal from '../../components/Modal'
import { buildApiUrl } from '../../config'
import { apiFetch } from '../../lib/api'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import type { User } from '../../types'
import styles from './SettingsPage.module.css'

function useNotificationPreferences() {
  const [roundReminders, setRoundReminders] = useState<boolean | null>(null)
  const [pending, setPending] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!success) return
    const id = setTimeout(() => setSuccess(false), 3000)
    return () => clearTimeout(id)
  }, [success])

  function loadPreferences() {
    setError(null)
    apiFetch(buildApiUrl('/notifications/preferences'))
      .then((res) => {
        if (!res.ok) throw new Error('Falha ao carregar preferências')
        return res.json() as Promise<{ round_reminders: boolean }>
      })
      .then((data) => setRoundReminders(data.round_reminders))
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    loadPreferences()
  }, [])

  function handleOpenModal(next: boolean) {
    trackEvent('click_settings_toggle_lembretes', { enabled: next })
    setPending(next)
  }

  function handleCancel() {
    trackEvent('click_settings_cancelar_lembretes')
    setPending(null)
  }

  function handleConfirm() {
    if (pending === null || saving) return
    const next = pending
    setPending(null)
    trackEvent('click_settings_confirmar_lembretes', { enabled: next })

    const previous = roundReminders
    savePreference(next, previous)
  }

  function savePreference(next: boolean, previous: boolean | null) {
    setRoundReminders(next)
    setSaving(true)
    setError(null)
    setSuccess(false)

    apiFetch(buildApiUrl('/notifications/preferences'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ round_reminders: next }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Falha ao salvar preferência')
        setSuccess(true)
      })
      .catch((err) => {
        setRoundReminders(previous)
        setError(err.message)
      })
      .finally(() => setSaving(false))
  }

  return {
    roundReminders,
    pending,
    saving,
    error,
    success,
    loadPreferences,
    handleOpenModal,
    handleCancel,
    handleConfirm,
  }
}

interface SettingsPageProps {
  user: User
  onLogout: () => void
}

export default function SettingsPage({ user, onLogout }: SettingsPageProps) {
  useDocumentTitle('Configurações')
  const navigate = useNavigate()

  const {
    roundReminders,
    pending,
    saving,
    error,
    success,
    loadPreferences,
    handleOpenModal,
    handleCancel,
    handleConfirm,
  } = useNotificationPreferences()

  return (
    <>
      <Header
        user={user}
        onCreateGroup={() => navigate('/')}
        onJoinGroup={() => navigate('/')}
        onLogout={onLogout}
      />

      <main className={styles.root}>
        <div className={styles.content}>
          <h1 className={styles.title}>Configurações</h1>

          {error && (
            <ErrorState>
              {error}
              {roundReminders === null && (
                <button
                  type="button"
                  onClick={() => {
                    trackEvent('click_settings_retry_preferencias')
                    loadPreferences()
                  }}
                  className={styles.retryButton}
                >
                  Tentar novamente
                </button>
              )}
            </ErrorState>
          )}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>E-mails</h2>

            <label className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>Lembretes de rodada</span>
                <span className={styles.rowHint}>
                  Receba um e-mail no dia anterior ao primeiro jogo de cada rodada.
                </span>
              </span>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={roundReminders ?? false}
                disabled={roundReminders === null || saving}
                onChange={(e) => handleOpenModal(e.target.checked)}
              />
            </label>
          </section>

          {success && <div className={styles.successMessage}>Configuração salva com sucesso.</div>}
        </div>
      </main>

      <Modal
        isOpen={pending !== null}
        onClose={handleCancel}
        title={pending ? 'Ativar lembretes de rodada' : 'Desativar lembretes de rodada'}
      >
        <p className={styles.modalText}>
          {pending
            ? 'Você receberá um e-mail no dia anterior ao primeiro jogo de cada rodada.'
            : 'Você não receberá mais e-mails de lembrete de rodada.'}
        </p>
        <div className={styles.modalActions}>
          <Button variant="secondary" type="button" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button variant="primary" type="button" onClick={handleConfirm}>
            Confirmar
          </Button>
        </div>
      </Modal>
    </>
  )
}
