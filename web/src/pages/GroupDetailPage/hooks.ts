import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { apiFetch, CONNECTION_ERROR, readApiError } from '../../lib/api'
import { buildApiUrl } from '../../config'
import { invalidateApiCache } from '../../lib/api-cache'
import { useConfirm } from '../../components/ConfirmModal'
import { trackEvent } from '../../analytics/ga'
import { isStandingsTabEligible } from '../../components/StandingsTab'
import { UNEXPECTED_RESPONSE } from '../../lib/responseShape'
import {
  type Tab,
  type GroupDetail,
  type User,
  DEFAULT_TAB,
  parseGroupDetail,
  parseTab,
} from './types'

export function useGroupDetail(groupId: string | undefined) {
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId) return
    setLoading(true)
    setError(null)
    apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}`))
      .then((r) => {
        if (!r.ok) throw new Error('Grupo não encontrado')
        return r.json() as Promise<unknown>
      })
      .then((body) => {
        const detail = parseGroupDetail(body)
        if (!detail) throw new Error(UNEXPECTED_RESPONSE)
        setGroup(detail)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId])

  return { group, setGroup, loading, error }
}

export function useGroupTabs(group: GroupDetail | null) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { pathname } = useLocation()
  const rawTab = parseTab(searchParams.get('tab'))
  // Rodada pedida pela faixa "Próximo prazo" do painel. Ela vale uma vez. A aba
  // Palpitar chama `clearRequestedRound` depois de abrir nela, e a troca de aba
  // também tira o parâmetro. Recarregar ou voltar à aba abre a rodada padrão.
  const requestedRound = searchParams.get('rodada')
  const showStandings = isStandingsTabEligible(group?.competition_type, group?.competition_code)
  const activeTab =
    rawTab === 'standings' && group !== null && !showStandings ? DEFAULT_TAB : rawTab

  function setActiveTab(tab: Tab) {
    trackEvent('click_group_detail_tab', { tab })
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('rodada')
        if (tab === DEFAULT_TAB) {
          next.delete('tab')
        } else {
          next.set('tab', tab)
        }
        return next
      },
      { replace: true },
    )
  }

  function clearRequestedRound() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('rodada')
        return next
      },
      { replace: true },
    )
  }

  function tabHref(tab: Tab): string {
    const params = new URLSearchParams(searchParams)
    params.delete('rodada')
    if (tab === DEFAULT_TAB) {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const qs = params.toString()
    if (tab === DEFAULT_TAB) return qs ? `${pathname}?${qs}` : pathname
    return `?${qs}`
  }

  function handleTabClick(e: React.MouseEvent<HTMLAnchorElement>, tab: Tab) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      setActiveTab(tab)
    }
  }

  return {
    activeTab,
    showStandings,
    tabHref,
    handleTabClick,
    requestedRound,
    clearRequestedRound,
  }
}

export function useTabsOffset() {
  const [tabsOffset, setTabsOffset] = useState(0)

  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return

    const updateOffset = () => setTabsOffset(header.clientHeight)

    updateOffset()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateOffset)
      observer.observe(header)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateOffset)
    return () => window.removeEventListener('resize', updateOffset)
  }, [])

  return tabsOffset
}

export function useGroupActions(groupId: string | undefined, user: User) {
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [rotatingInvite, setRotatingInvite] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  async function leaveGroup() {
    if (!groupId) return
    trackEvent('click_group_detail_menu_sair')

    const ok = await confirm({
      title: 'Sair do grupo',
      message: 'Tem certeza que deseja sair deste grupo?',
      confirmLabel: 'Sair',
      danger: true,
    })
    if (!ok) return

    setLeaving(true)

    try {
      const res = await apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(user.id)}`), {
        method: 'DELETE',
      })

      if (!res.ok) {
        window.alert(await readApiError(res, 'Erro ao sair do grupo'))
        return
      }

      invalidateApiCache('groups:')
      navigate('/', { replace: true })
    } catch {
      window.alert(CONNECTION_ERROR)
    } finally {
      setLeaving(false)
    }
  }

  async function deleteGroup() {
    if (!groupId) return
    trackEvent('click_group_detail_menu_excluir')

    const ok = await confirm({
      title: 'Excluir grupo',
      message:
        'Tem certeza que deseja excluir este grupo? Ele deixará de aparecer para todos os membros.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return

    setDeleting(true)

    try {
      const res = await apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}`), {
        method: 'DELETE',
      })

      if (!res.ok) {
        window.alert(await readApiError(res, 'Erro ao excluir grupo'))
        return
      }

      invalidateApiCache('groups:')
      navigate('/', { replace: true, state: { refreshGroups: true } })
    } catch {
      window.alert(CONNECTION_ERROR)
    } finally {
      setDeleting(false)
    }
  }

  /** Troca o código de convite (só o dono). O código antigo para de funcionar. */
  async function rotateInvite(onRotated: (inviteCode: string) => void) {
    if (!groupId) return
    trackEvent('click_group_detail_trocar_convite')

    const ok = await confirm({
      title: 'Trocar código de convite',
      message:
        'O código e o link atuais deixam de funcionar. Quem já está no grupo continua nele. Deseja gerar um novo código?',
      confirmLabel: 'Trocar código',
      danger: true,
    })
    if (!ok) return

    setRotatingInvite(true)

    try {
      const res = await apiFetch(buildApiUrl(`/groups/${encodeURIComponent(groupId)}/invite/rotate`), {
        method: 'POST',
      })
      if (!res.ok) {
        window.alert(await readApiError(res, 'Erro ao trocar o código de convite'))
        return
      }
      const body = (await res.json()) as { invite_code?: string }
      if (!body.invite_code) {
        window.alert('Erro ao trocar o código de convite')
        return
      }

      invalidateApiCache('groups:')
      onRotated(body.invite_code)
    } catch {
      window.alert(CONNECTION_ERROR)
    } finally {
      setRotatingInvite(false)
    }
  }

  return {
    leaveGroup,
    leaving,
    deleteGroup,
    deleting,
    rotateInvite,
    rotatingInvite,
    confirmDialog,
  }
}
