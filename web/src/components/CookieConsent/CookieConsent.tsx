import { useEffect, useRef, useState } from 'react'
import { gaEnabled, getStoredConsent, setConsent } from '../../analytics/ga'
import styles from './CookieConsent.module.css'

/**
 * Aviso de cookies do GA e botão de preferências no rodapé. O aviso abre sozinho
 * sem escolha salva e reabre pelo botão.
 * A leitura do storage fica no efeito para preservar a hidratação da landing:
 * tanto o HTML pré-renderizado quanto o primeiro render começam sem o aviso.
 */
export default function CookieConsent() {
  const preferencesRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (gaEnabled && getStoredConsent() === null) setVisible(true)
  }, [])

  useEffect(() => {
    if (visible && document.activeElement === preferencesRef.current) rejectRef.current?.focus()
    const banner = bannerRef.current
    if (!visible || !banner) return
    const updateHeight = () => {
      const bottom = parseFloat(getComputedStyle(banner).bottom) || 0
      document.documentElement.style.setProperty(
        '--consent-banner-height',
        `${Math.ceil(banner.getBoundingClientRect().height + bottom)}px`,
      )
    }
    updateHeight()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight)
    observer?.observe(banner)
    window.addEventListener('resize', updateHeight)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateHeight)
      document.documentElement.style.removeProperty('--consent-banner-height')
    }
  }, [visible])

  function dismiss() {
    setVisible(false)
    preferencesRef.current?.focus({ preventScroll: true })
  }

  if (!gaEnabled) return null

  return (
    <>
      <div className={styles.preferences}>
        <button
          ref={preferencesRef}
          type="button"
          aria-expanded={visible}
          onClick={() => {
            setVisible(true)
          }}
        >
          Preferências de cookies
        </button>
      </div>
      {visible && (
        <div
          ref={bannerRef}
          className={styles.banner}
          role="dialog"
          aria-label="Aviso de cookies"
          aria-live="polite"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              dismiss()
            }
          }}
        >
          <p className={styles.text}>
            Cookies do Google Analytics medem o uso para melhorar o Palpitae. Você decide.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              ref={rejectRef}
              className={styles.reject}
              onClick={() => {
                setConsent('denied')
                dismiss()
              }}
            >
              Recusar
            </button>
            <button
              type="button"
              className={styles.accept}
              onClick={() => {
                setConsent('granted')
                dismiss()
              }}
            >
              Aceitar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
