import { test, expect, type Page } from '@playwright/test'

/**
 * No CTA do guia do Brasileirão, `/entrar?from=…&competicao=…` atravessa o login
 * pelo Google e abre o formulário de criação com a Série A 2027 escolhida.
 */
test.describe('Guia do Brasileirão com a competição escolhida na criação', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  const from = 'guia_bolao-do-brasileirao'
  const slug2027 = 'campeonato-brasileiro-serie-a-2027'
  const query = `?from=${from}&competicao=${slug2027}`
  const warning = 'A competição do link ainda não está disponível. Escolha outra na lista.'

  const serieA2026 = {
    id: 'bsa-2026',
    name: 'Campeonato Brasileiro Série A',
    slug: 'campeonato-brasileiro-serie-a-2026',
    season: '2026',
    status: 'ongoing',
  }
  const serieA2027 = {
    id: 'bsa-2027',
    name: 'Campeonato Brasileiro Série A',
    slug: slug2027,
    season: '2027',
    status: 'upcoming',
  }

  /** Simula a volta do OAuth com sessão válida, nenhum grupo e a lista de competições dada. */
  async function mockLoggedIn(page: Page, competitions: unknown[]) {
    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          user: {
            id: 'user-1',
            email: 'test@example.com',
            feature_flags: { create_group: true },
          },
        },
      })
    })
    await page.route('**/api/groups**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders })
        return
      }
      await route.fulfill({
        headers: corsHeaders,
        json: { groups: [], matched_invite_group_id: null },
      })
    })
    await page.route('**/api/competitions**', async (route) => {
      await route.fulfill({ headers: corsHeaders, json: { competitions } })
    })
  }

  test('o login pelo Google leva `from`, `competicao` e a origem do guia', async ({ page }) => {
    await page.route('**/auth/me', async (route) => {
      await route.fulfill({ headers: corsHeaders, json: { authenticated: false } })
    })
    await page.route('**/auth/google**', async (route) => {
      await route.fulfill({ contentType: 'text/html', body: '<p>Google</p>' })
    })

    await page.goto(`/entrar${query}`)
    const googleRequest = page.waitForRequest('**/auth/google**')
    await page.getByRole('button', { name: 'Entrar com Google' }).click()

    const url = new URL((await googleRequest).url())
    const redirect = new URLSearchParams(url.searchParams.get('redirect') ?? '')
    expect(redirect.get('from')).toBe(from)
    expect(redirect.get('competicao')).toBe(slug2027)
    expect(url.searchParams.get('origem')).toBe(from)
  })

  test('na volta do login, a criação abre com a Série A 2027 escolhida', async ({ page }) => {
    await mockLoggedIn(page, [serieA2026, serieA2027])

    await page.goto(`/${query}`)

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Criar grupo' })).toBeVisible()
    await expect(dialog.getByLabel('Competição')).toHaveValue('bsa-2027')
    await expect(dialog.getByText(warning)).toHaveCount(0)
    // Só o `competicao` sai da URL, para recarregar não reabrir o modal.
    await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === `?from=${from}`)
  })

  test('quem já tem sessão vai de /entrar para a criação com a Série A 2027', async ({ page }) => {
    await mockLoggedIn(page, [serieA2026, serieA2027])

    await page.goto(`/entrar${query}`)

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Competição')).toHaveValue('bsa-2027')
    await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === `?from=${from}`)
  })

  test('sem a Série A 2027 na lista, a criação abre na primeira com o aviso', async ({ page }) => {
    await mockLoggedIn(page, [serieA2026])

    await page.goto(`/${query}`)

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Criar grupo' })).toBeVisible()
    const select = dialog.getByLabel('Competição')
    await expect(select).toHaveValue('bsa-2026')
    await expect(dialog.getByText(warning)).toBeVisible()
    // A Série A 2026 já começou, então o select também é descrito pelo aviso de campeonato em andamento.
    await expect(select).toHaveAccessibleDescription(/A competição do link ainda não está disponível/)
    await expect(select).toHaveAccessibleDescription(/Esse campeonato já começou/)
  })
})
