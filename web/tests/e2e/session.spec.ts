import { test, expect, type Page } from '@playwright/test'

const USER = { id: 'user-1', email: 'test@example.com', nickname: 'Ana' }

interface ApiState {
  authenticated: boolean
  groupsStatus: number
  logoutStatus: number
}

/** API simulada no mesmo origin do Vite (`VITE_API_URL=http://localhost:5173/api`). */
async function mockApi(page: Page, state: ApiState) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '')
    if (path === '/auth/me') {
      await route.fulfill({ json: state.authenticated ? { user: USER } : { authenticated: false } })
    } else if (path === '/auth/logout') {
      state.authenticated = false
      await route.fulfill(
        state.logoutStatus === 200
          ? { json: { ok: true } }
          : {
              status: state.logoutStatus,
              json: { error: 'Não foi possível encerrar a sessão no servidor' },
            },
      )
    } else if (path === '/groups') {
      await route.fulfill(
        state.groupsStatus === 200
          ? { json: { groups: [] } }
          : { status: state.groupsStatus, json: { error: 'Não autenticado' } },
      )
    } else if (path.startsWith('/notifications/preferences')) {
      await route.fulfill({ json: { preferences: { round_reminders: false, promotions: false } } })
    } else {
      await route.fulfill({ json: {} })
    }
  })
}

async function logout(page: Page) {
  await page.getByRole('button', { name: `Menu de ${USER.nickname}` }).click()
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
}

test.describe('Sessão', () => {
  test('o aviso de expiração não passa para o login seguinte', async ({ page }) => {
    const state = { authenticated: true, groupsStatus: 401, logoutStatus: 200 }
    await mockApi(page, state)

    // A sessão expira no painel: "/" vira a landing, que não mostra o aviso.
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Entrar' }).first()).toBeVisible()

    // Novo login na mesma aba (a volta do Google é uma navegação completa).
    state.groupsStatus = 200
    await page.goto('/configuracoes')
    await expect(page.getByRole('heading', { name: 'Conta' })).toBeVisible()

    await logout(page)
    await expect(page.getByRole('heading', { name: 'Bem-vindo ao Palpitae' })).toBeVisible()
    await expect(page.getByText('Sua sessão expirou')).toHaveCount(0)
  })

  test('logout sem confirmação do servidor leva ao login com o aviso', async ({ page }) => {
    const state = { authenticated: true, groupsStatus: 200, logoutStatus: 503 }
    await mockApi(page, state)

    await page.goto('/')
    await expect(page.getByRole('button', { name: `Menu de ${USER.nickname}` })).toBeVisible()
    await logout(page)

    await expect(page).toHaveURL(/\/entrar$/)
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Não conseguimos confirmar no servidor')
    await expect(alert).toContainText('Sair de todos os dispositivos')

    // O aviso vale uma vez: recarregar /entrar não o repete.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Bem-vindo ao Palpitae' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('logout confirmado continua na landing, sem aviso', async ({ page }) => {
    const state = { authenticated: true, groupsStatus: 200, logoutStatus: 200 }
    await mockApi(page, state)

    await page.goto('/')
    await logout(page)

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: 'Entrar' }).first()).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
