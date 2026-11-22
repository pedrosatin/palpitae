import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import {
  notificationPreferencesQueryOptions,
  patchNotificationPreferences,
  setNotificationPreferencesCache,
} from '../../lib/notificationPreferences'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import type { User } from '../../types'
import styles from './SettingsPage.module.css'

const REMINDER_RULE =
  'Nos dias em que você tem jogo sem palpite, enviamos um e-mail às 7h, horário de Brasília, com os jogos daquele dia e o horário em que cada um fecha. Se já palpitou todos, você não recebe nada.'

function useNotificationPreferences() {
  const queryClient = useQueryClient()
  const query = useQuery(notificationPreferencesQueryOptions())
  const [pending, setPending] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!success) return
    const id = setTimeout(() => setSuccess(false), 3000)
    return () => clearTimeout(id)
  }, [success])

  const saveMutation = useMutation({
    mutationFn: patchNotificationPreferences,
    onMutate: async (next) => {
      setSaveError(null)
      setSuccess(false)
      const previous = query.data?.round_reminders ?? null
      setNotificationPreferencesCache(queryClient, next)
      return { previous }
    },
    onSuccess: () => {
      setSuccess(true)
    },
    onError: (err, _next, context) => {
      if (context?.previous !== null && context?.previous !== undefined) {
        setNotificationPreferencesCache(queryClient, context.previous)
      }
      setSaveError(err instanceof Error ? err.message : 'Falha ao salvar preferência')
    },
  })

  const roundReminders = query.data?.round_reminders ?? null
  const loadError =
    roundReminders === null && query.isError
      ? query.error instanceof Error
        ? query.error.message
        : 'Falha ao carregar preferências'
      : null
  const error = saveError ?? loadError

  function handleOpenModal(next: boolean) {
    trackEvent('click_settings_toggle_lembretes', { enabled: next })
    setPending(next)
  }

  function handleCancel() {
    trackEvent('click_settings_cancelar_lembretes')
    setPending(null)
  }

  function handleConfirm() {
    if (pending === null || saveMutation.isPending) return
    const next = pending
    setPending(null)
    trackEvent('click_settings_confirmar_lembretes', { enabled: next })
    saveMutation.mutate(next)
  }

  return {
    roundReminders,
    pending,
    saving: saveMutation.isPending,
    error,
    success,
    loadPreferences: () => {
      setSaveError(null)
      void query.refetch()
    },
    handleOpenModal,
    handleCancel,
    handleConfirm,
  }
}

const LOGOUT_ALL_ERROR = 'Não foi possível sair de todos os dispositivos. Tente de novo.'

function useLogoutAll(onLoggedOut: () => void) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(buildApiUrl('/auth/logout-all'), { method: 'POST' })
      if (res.status === 401) return { expired: true as const }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { expired: false as const }
    },
    onSuccess: (result) => {
      queryClient.clear()
      if (result.expired) return
      trackEvent('settings_sair_todos_concluido')
      onLoggedOut()
    },
    onError: () => {
      setError(LOGOUT_ALL_ERROR)
    },
  })

  async function logoutAll() {
    if (logoutMutation.isPending) return
    trackEvent('click_settings_sair_todos')
    const ok = await confirm({
      title: 'Sair de todos os dispositivos',
      message:
        'Você vai sair do Palpitae em todos os navegadores e celulares, inclusive neste. Para voltar, entre de novo com o Google.',
      confirmLabel: 'Sair de todos',
      danger: true,
    })
    if (!ok) return
    setError(null)
    logoutMutation.mutate()
  }

  return {
    loggingOut: logoutMutation.isPending,
    error,
    logoutAll,
    confirmDialog,
  }
}

interface SettingsPageProps {
  user: User
  onLogout: () => void
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
                <span className={styles.rowLabel}>Lembretes de palpite</span>
                <span className={styles.rowHint}>{REMINDER_RULE}</span>
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
        title={pending ? 'Ativar lembretes de palpite' : 'Desativar lembretes de palpite'}
        analyticsId="lembretes_palpite"
      >
        <p className={styles.modalText}>
          {pending ? REMINDER_RULE : 'Você não receberá mais e-mails de lembrete de palpite.'}
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
