import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trackEvent } from '../../analytics/ga'
import Header from '../../components/Header'
import { buildApiUrl } from '../../config'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import styles from './SettingsPage.module.css'

interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
  feature_flags?: {
    create_group?: boolean
  }
}

interface SettingsPageProps {
  user: User
  onLogout: () => void
}

export default function SettingsPage({ user, onLogout }: SettingsPageProps) {
  useDocumentTitle('Configurações')
  const navigate = useNavigate()

  const [roundReminders, setRoundReminders] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(buildApiUrl('/notifications/preferences'), { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Falha ao carregar preferências')
        return res.json() as Promise<{ round_reminders: boolean }>
      })
      .then((data) => setRoundReminders(data.round_reminders))
      .catch((err) => setError(err.message))
  }, [])

  function handleToggle(next: boolean) {
    if (saving) return
    trackEvent('click_settings_toggle_lembretes', { enabled: next })

    const previous = roundReminders
    setRoundReminders(next) // optimistic
    setSaving(true)
    setError(null)

    fetch(buildApiUrl('/notifications/preferences'), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ round_reminders: next }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Falha ao salvar preferência')
      })
      .catch((err) => {
        setRoundReminders(previous) // rollback
        setError(err.message)
      })
      .finally(() => setSaving(false))
  }

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

          {error && <div className={styles.errorMessage}>{error}</div>}

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
                onChange={(e) => handleToggle(e.target.checked)}
              />
            </label>
          </section>
        </div>
      </main>
    </>
  )
}
