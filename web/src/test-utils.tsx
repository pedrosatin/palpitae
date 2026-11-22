import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  render,
  renderHook,
  type RenderHookOptions,
  type RenderOptions,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { appQueryDefaults } from './lib/queryClient'

/** QueryClient novo por teste: mesmos defaults da app, sem retry. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { ...appQueryDefaults, retry: false },
      mutations: { retry: false, networkMode: 'always' },
    },
  })
}

type QueryExtras = { queryClient?: QueryClient }

function QueryWrapper({
  client,
  children,
}: {
  client: QueryClient
  children: ReactNode
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export function renderWithQuery(
  ui: ReactElement,
  {
    queryClient = createTestQueryClient(),
    ...options
  }: Omit<RenderOptions, 'wrapper'> & QueryExtras = {},
) {
  return {
    ...render(ui, {
      ...options,
      wrapper: ({ children }) => <QueryWrapper client={queryClient}>{children}</QueryWrapper>,
    }),
    queryClient,
  }
}

export function renderHookWithQuery<TResult, TProps>(
  hook: (props: TProps) => TResult,
  {
    queryClient = createTestQueryClient(),
    ...options
  }: Omit<RenderHookOptions<TProps>, 'wrapper'> & QueryExtras = {},
) {
  return {
    ...renderHook(hook, {
      ...options,
      wrapper: ({ children }) => <QueryWrapper client={queryClient}>{children}</QueryWrapper>,
    }),
    queryClient,
  }
}
