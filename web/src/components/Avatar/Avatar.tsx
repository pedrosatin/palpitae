import { useState } from 'react'
import styles from './Avatar.module.css'

interface AvatarProps {
  /** Nome mostrado ao lado do avatar. A inicial vem dele. */
  name: string
  src?: string | null
  /** Aplicada à foto e à inicial. Define tamanho e cor pelas variáveis do CSS. */
  className?: string
  /** Aplicada só à inicial. */
  fallbackClassName?: string
}

/**
 * Foto do usuário ou, sem foto ou com foto quebrada, a inicial do nome.
 * É decorativo, porque o nome já aparece ao lado, e fica fora da árvore de
 * acessibilidade. O tamanho padrão é 2rem e muda com `--avatar-size`,
 * `--avatar-font-size` e `--avatar-color` na classe de quem usa.
 */
export default function Avatar({ name, src, className, fallbackClassName }: AvatarProps) {
  // Guarda a URL que falhou para voltar à inicial sem esconder uma foto nova.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        className={[styles.photo, className].filter(Boolean).join(' ')}
        onError={() => setFailedSrc(src)}
      />
    )
  }

  return (
    <span
      className={[styles.fallback, className, fallbackClassName].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {/* Array.from separa por ponto de código e não parte o emoji ao meio. */}
      {Array.from(name)[0]?.toUpperCase()}
    </span>
  )
}
