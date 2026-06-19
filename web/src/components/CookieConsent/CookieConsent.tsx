import { useState } from 'react'
import {
  gaEnabled,
  getStoredConsent,
  setConsent,
  type Consent,
} from '../../analytics/ga'
import styles from './CookieConsent.module.css'

/**
 * Banner de consentimento de cookies (LGPD) para o Google Analytics.
 *
 * Só aparece quando o GA está configurado (`gaEnabled`) e ainda não houve uma
 * escolha salva. "Aceitar" faz upgrade do Consent Mode para `granted`;
 * "Recusar" mantém o GA em modo sem cookie. A decisão persiste em localStorage,
 * então o banner não reaparece nas próximas visitas.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(
    () => gaEnabled && getStoredConsent() === null,
  )

  if (!visible) return null

  function decide(consent: Consent) {
    setConsent(consent)
    setVisible(false)
  }

  return (
    <div
      className={styles.banner}
      role="dialog"
      aria-label="Aviso de cookies"
      aria-live="polite"
    >
      <p className={styles.text}>
        Usamos cookies do Google Analytics para entender como o site é usado e
        melhorar o Palpitae. Você decide.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reject}
          onClick={() => decide('denied')}
        >
          Recusar
        </button>
        <button
          type="button"
          className={styles.accept}
          onClick={() => decide('granted')}
        >
          Aceitar
        </button>
      </div>
    </div>
  )
}
