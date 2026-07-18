import { useCallback, useState } from 'react'
import ConfirmModal from './ConfirmModal'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

/**
 * Promise-based replacement for window.confirm using the ConfirmModal UI.
 *
 *   const { confirm, confirmDialog } = useConfirm()
 *   if (!(await confirm({ message: '...' }))) return
 *   // ...render {confirmDialog} somewhere in the component tree
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve)
    })
  }, [])

  const close = useCallback(
    (result: boolean) => {
      resolver?.(result)
      setResolver(null)
      setOptions(null)
    },
    [resolver],
  )

  const confirmDialog = (
    <ConfirmModal
      isOpen={options !== null}
      title={options?.title}
      message={options?.message ?? ''}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      danger={options?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  )

  return { confirm, confirmDialog }
}
