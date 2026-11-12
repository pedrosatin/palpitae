import { useCallback, useEffect, useState } from 'react'

/** Resultado de uma carga dos painéis admin. A função de carga nunca lança: falha vira `failed`. */
export type AdminLoad<T> = { kind: 'ok'; data: T } | { kind: 'forbidden' } | { kind: 'failed' }

type AdminLoadState<T> = {
  data: T | null
  error: 'forbidden' | 'failed' | null
  loading: boolean
}

const LOADING = { data: null, error: null, loading: true } as const

/**
 * Carga dos painéis admin por período (métricas, radar).
 *
 * A carga inteira, inclusive a leitura dos corpos, termina antes de qualquer
 * mudança de estado. Só a carga do período e da tentativa atuais é aplicada:
 * resposta ou erro de um período anterior, ou chegados depois de a página
 * sair da tela, são descartados. Dado, erro e carregamento mudam juntos, então
 * nada do período anterior fica na tela ao lado do erro do atual.
 *
 * `load` precisa ter identidade estável (função de módulo).
 */
export function useAdminLoad<T>(
  days: number,
  load: (days: number) => Promise<AdminLoad<T>>,
): AdminLoadState<T> & { retry: () => void } {
  const [state, setState] = useState<AdminLoadState<T>>(LOADING)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setState(LOADING)
    load(days)
      .catch((): AdminLoad<T> => ({ kind: 'failed' }))
      .then((result) => {
        if (!current) return
        setState(
          result.kind === 'ok'
            ? { data: result.data, error: null, loading: false }
            : { data: null, error: result.kind, loading: false },
        )
      })
    return () => {
      current = false
    }
  }, [days, attempt, load])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry }
}
