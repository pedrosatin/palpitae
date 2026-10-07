import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trackEvent } from '../../analytics/ga'
import Button from '../../components/Button'
import { useConfirm } from '../../components/ConfirmModal'
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

const LOGOUT_ALL_ERROR = 'Não foi possível sair de todos os dispositivos. Tente de novo.'

/**
 * "Sair de todos os dispositivos": confirma, chama `POST /auth/logout-all` e,
 * com sucesso, avisa o App para voltar ao estado deslogado. Em erro a sessão
 * continua válida no servidor, então a página mostra o erro e o usuário pode
 * tentar de novo.
 */
function useLogoutAll(onLoggedOut: () => void) {
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  async function logoutAll() {
    if (loggingOut) return
    trackEvent('click_settings_sair_todos')
    const ok = await confirm({
      title: 'Sair de todos os dispositivos',
      message:
        'Você vai sair do Palpitae em todos os navegadores e celulares, inclusive neste. Para voltar, entre de novo com o Google.',
      confirmLabel: 'Sair de todos',
      danger: true,
    })
    if (!ok) return
    setLoggingOut(true)
    setError(null)
    try {
      const res = await apiFetch(buildApiUrl('/auth/logout-all'), { method: 'POST' })
      // 401: o apiFetch já avisou o App, que leva ao login.
      if (res.status === 401) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      trackEvent('settings_sair_todos_concluido')
      onLoggedOut()
    } catch {
      setError(LOGOUT_ALL_ERROR)
    } finally {
      setLoggingOut(false)
    }
  }

  return { loggingOut, error, logoutAll, confirmDialog }
}

interface SettingsPageProps {
  user: User
  onLogout: () => void
  /** Chamado depois que `POST /auth/logout-all` encerrou todas as sessões. */
  onLogoutAll: () => void
}

export default function SettingsPage({ user, onLogout, onLogoutAll }: SettingsPageProps) {
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
  const logoutAll = useLogoutAll(onLogoutAll)

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

          <section className={`${styles.section} ${styles.accountSection}`}>
            <h2 className={styles.sectionTitle}>Conta</h2>

            {logoutAll.error && <ErrorState>{logoutAll.error}</ErrorState>}

            <div className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>Sair de todos os dispositivos</span>
                <span className={styles.rowHint}>
                  Encerra a sessão em todos os navegadores e celulares, inclusive neste.
                </span>
              </span>
              <Button
                variant="danger"
                size="sm"
                type="button"
                onClick={logoutAll.logoutAll}
                disabled={logoutAll.loggingOut}
              >
                {logoutAll.loggingOut ? 'Saindo…' : 'Sair de todos'}
              </Button>
            </div>
          </section>
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

      {logoutAll.confirmDialog}
    </>
  )
}
