import { useEffect, useState } from 'react'
import { type InviteLookup, lookupInvite, readEmbeddedInvite } from '../../lib/invitePreview'

export type InviteState = InviteLookup | { status: 'loading' }

function initialState(code: string | null): InviteState {
  if (!code) return { status: 'invalid' }
  const preview = readEmbeddedInvite(code)
  return preview ? { status: 'ready', preview } : { status: 'loading' }
}

/**
 * Estado do convite. Quando a Pages Function embutiu os dados no HTML, o
 * primeiro render já sai pronto. A chamada à API só acontece sem esses dados.
 * Código com formato inválido não chega à API.
 */
export function useInvitePreview(code: string | null): InviteState {
  const [state, setState] = useState<InviteState>(() => initialState(code))
  const needsLookup = state.status === 'loading'

  useEffect(() => {
    if (!needsLookup || !code) return
    let cancelled = false
    void lookupInvite(code).then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, needsLookup])

  return state
}
