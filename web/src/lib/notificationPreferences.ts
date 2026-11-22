import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { buildApiUrl } from '../config'
import { apiFetch } from './api'

export type NotificationPreferences = {
  round_reminders: boolean
}

export const notificationPreferencesQueryKey = ['notifications', 'preferences'] as const

export function fetchNotificationPreferences(
  signal?: AbortSignal,
): Promise<NotificationPreferences> {
  return apiFetch(buildApiUrl('/notifications/preferences'), { signal }).then((res) => {
    if (!res.ok) throw new Error('Falha ao carregar preferências')
    return res.json() as Promise<NotificationPreferences>
  })
}

export function notificationPreferencesQueryOptions() {
  return queryOptions({
    queryKey: notificationPreferencesQueryKey,
    queryFn: ({ signal }) => fetchNotificationPreferences(signal),
  })
}

export async function patchNotificationPreferences(
  roundReminders: boolean,
): Promise<void> {
  const res = await apiFetch(buildApiUrl('/notifications/preferences'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ round_reminders: roundReminders }),
  })
  if (!res.ok) throw new Error('Falha ao salvar preferência')
}

export function setNotificationPreferencesCache(
  queryClient: QueryClient,
  roundReminders: boolean,
) {
  queryClient.setQueryData<NotificationPreferences>(notificationPreferencesQueryKey, {
    round_reminders: roundReminders,
  })
}
