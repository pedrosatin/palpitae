import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { config } from '../../config'
import { invalidateApiCache } from '../../lib/api-cache'
import { useConfirm } from '../../components/ConfirmModal'
import { trackEvent } from '../../analytics/ga'
import { type Tab, type GroupDetail, type User, DEFAULT_TAB, parseTab } from './types'

export function useGroupDetail(groupId: string | undefined) {
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId) return
    setLoading(true)
    setError(null)
    apiFetch(`${config.apiUrl}/groups/${groupId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Grupo não encontrado')
        return r.json() as Promise<{ group: GroupDetail }>
      })
      .then((data) => setGroup(data.group))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [groupId])

  return { group, setGroup, loading, error }
}

export function useGroupTabs(group: GroupDetail | null) {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = parseTab(searchParams.get('tab'))
  const showStandings = group?.competition_type === 'league'
  const activeTab = rawTab === 'standings' && group !== null && !showStandings ? DEFAULT_TAB : rawTab

  function setActiveTab(tab: Tab) {
    trackEvent('click_group_detail_tab', { tab })
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
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

  function tabHref(tab: Tab): string {
    const params = new URLSearchParams(searchParams)
    if (tab === DEFAULT_TAB) {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const qs = params.toString()
    return qs ? `?${qs}` : '.'
  }

  function handleTabClick(e: React.MouseEvent<HTMLAnchorElement>, tab: Tab) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      setActiveTab(tab)
    }
  }

  return { activeTab, showStandings, tabHref, handleTabClick }
}

export function useTabsOffset() {
  const [tabsOffset, setTabsOffset] = useState(0)

  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return

    const updateOffset = () => setTabsOffset(header.clientHeight)

    updateOffset()

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOffset)

    if (observer) {
      observer.observe(header)
    } else {
      window.addEventListener('resize', updateOffset)
    }

    return () => {
      observer?.disconnect()
      if (!observer) {
        window.removeEventListener('resize', updateOffset)
      }
    }
  }, [])

  return tabsOffset
}

export function useGroupActions(groupId: string | undefined, user: User) {
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
      const res = await apiFetch(`${config.apiUrl}/groups/${groupId}/members/${user.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao sair do grupo')
      }

      invalidateApiCache('groups:')
      navigate('/', { replace: true })
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Erro ao sair do grupo')
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
      const res = await apiFetch(`${config.apiUrl}/groups/${groupId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao excluir grupo')
      }

      invalidateApiCache('groups:')
      navigate('/', { replace: true, state: { refreshGroups: true } })
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Erro ao excluir grupo')
    } finally {
      setDeleting(false)
    }
  }

  return { leaveGroup, leaving, deleteGroup, deleting, confirmDialog }
}
