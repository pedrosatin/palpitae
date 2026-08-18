import { useEffect, useState } from 'react'
import { gaEnabled, getStoredConsent, setConsent } from '../../analytics/ga'
import styles from './CookieConsent.module.css'

/**
 * Banner de consentimento de cookies (LGPD) para o Google Analytics.
 *
 * Só aparece quando o GA está configurado (`gaEnabled`) e ainda não houve uma
 * escolha salva. "Aceitar" faz upgrade do Consent Mode para `granted`;
 * "Recusar" mantém o GA em modo sem cookie. A decisão persiste em localStorage,
 * então o banner não reaparece nas próximas visitas.
 *
 * A decisão de mostrar depende de `localStorage`, que não existe no build que
 * pré-renderiza a landing (ver `src/entry-server.tsx`). Por isso ela sai de um
 * efeito, e não do estado inicial: no primeiro render — o único que a hidratação
 * compara com o HTML gerado no build — o banner é sempre ausente nos dois lados.
 * Ler o storage durante o render devolveria valores diferentes no servidor e no
 * navegador, que é a receita clássica de erro de hidratação.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (gaEnabled && getStoredConsent() === null) setVisible(true)
  }, [])

  if (!visible) return null

  return (
    <div className={styles.banner} role="dialog" aria-label="Aviso de cookies" aria-live="polite">
      <p className={styles.text}>
        Usamos cookies do Google Analytics para entender como o site é usado e melhorar o Palpitae.
        Você decide.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reject}
          onClick={() => {
            setConsent('denied')
            setVisible(false)
          }}
        >
          Recusar
        </button>
        <button
          type="button"
          className={styles.accept}
          onClick={() => {
            setConsent('granted')
            setVisible(false)
          }}
        >
          Aceitar
        </button>
      </div>
    </div>
  )
}
