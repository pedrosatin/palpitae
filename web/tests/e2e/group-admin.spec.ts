import { test, expect } from '@playwright/test'

test.describe('Group Admin and Member Tools', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()))

    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        headers: corsHeaders,
        json: { user: { id: 'user-1', email: 'test@example.com' } },
      })
    })

    await page.route('**/api/competitions**', async (route) => {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          competitions: [{ id: 'comp-1', name: 'Brasileirão', slug: 'brasileirao' }],
        },
      })
    })

    await page.route('**/api/matches**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders })
      } else {
        await route.fulfill({
          headers: corsHeaders,
          json: { matches: [], default_round: '1' },
        })
      }
    })

    await page.route('**/api/predictions**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders })
      } else {
        await route.fulfill({ headers: corsHeaders, json: { predictions: [] } })
      }
    })
  })

  test('Deve visualizar abas e editar grupo como admin', async ({ page }) => {
    let patchCalled = false

    await page.route('**/api/groups**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()

      if (method === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders })
        return
      }

      if (method === 'GET' && url.endsWith('/members')) {
        await route.fulfill({ headers: corsHeaders, json: { members: [] } })
      } else if (method === 'GET' && url.endsWith('/ranking')) {
        await route.fulfill({ headers: corsHeaders, json: { ranking: [] } })
      } else if (method === 'GET' && url.endsWith('/group-1')) {
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: {
              id: 'group-1',
              name: 'Grupo Original',
              is_admin: true,
              competition_name: 'Brasileirão',
            },
          },
        })
      } else if (method === 'PATCH' && url.includes('/group-1')) {
        patchCalled = true
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: { id: 'group-1', name: 'Grupo Editado', is_admin: true },
          },
        })
      } else {
        await route.continue()
      }
    })

    // 1. Acessar a página de um grupo
    await page.goto('/grupos/group-1')

    // 2. Navegar nas abas secundárias
    await page.getByRole('link', { name: /Ranking/i }).click()
    await page.getByRole('link', { name: /Membros/i }).click()

    // 3. Abrir o Menu Kebab
    const editMenuText = page.getByText(/Editar nome/i)
    if (!(await editMenuText.isVisible())) {
      await page.getByRole('button', { name: 'Opções do grupo' }).click()
    }

    // 4. Selecionar "Editar nome" e alterar no modal
    await editMenuText.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('input').fill('Grupo Editado')
    await dialog.getByRole('button', { name: /Salvar/i }).click()

    // 5. Validar o request de PATCH e atualização otimista
    await expect(page.locator('h1').filter({ hasText: 'Grupo Editado' })).toBeVisible()
    expect(patchCalled).toBe(true)
  })

  test('Deve ver apenas a opção de sair do grupo como membro comum', async ({ page }) => {
    let leaveCalled = false

    await page.route('**/api/groups**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()

      if (method === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders })
        return
      }

      if (method === 'DELETE' && url.includes('/members/user-1')) {
        leaveCalled = true
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: { success: true },
        })
      } else if (method === 'GET' && url.endsWith('/group-1')) {
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: {
              id: 'group-1',
              name: 'Grupo Original',
              is_admin: false,
              competition_name: 'Brasileirão',
            },
          },
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/grupos/group-1')

    // Verificar que não existe edição
    await expect(page.getByText(/Editar nome/i)).not.toBeVisible()

    // Procurar "Sair do grupo"
    const leaveGroupBtn = page.getByText(/Sair do grupo/i)
    if (!(await leaveGroupBtn.isVisible())) {
      await page.getByRole('button', { name: 'Opções do grupo' }).click()
    }

    await leaveGroupBtn.click()

    // Confirmar saída no modal
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Sair|Confirmar/i })
      .click()

    // Validar deleção e possível redirecionamento
    // Let's use waitForRequest or just wait a bit, but there is no navigation to wait for in this mock.
    // Instead of expect(leaveCalled).toBe(true) immediately, we wait.
    await page.waitForResponse(
      (response) => response.url().includes('/members/user-1') && response.status() === 200,
    )
    expect(leaveCalled).toBe(true)
  })
})
