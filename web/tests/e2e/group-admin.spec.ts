import { test, expect } from '@playwright/test'

// A página de grupo só aceita id no formato de UUID (#726).
const GROUP_ID = '00000000-0000-4000-8000-0000000000a1'

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
      } else if (method === 'GET' && url.endsWith(`/${GROUP_ID}`)) {
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: {
              id: GROUP_ID,
              name: 'Grupo Original',
              is_admin: true,
              competition_id: 'comp-1',
              competition_name: 'Brasileirão',
              points_exact: 3,
              points_winner: 1,
              member_count: 2,
            },
          },
        })
      } else if (method === 'PATCH' && url.includes(`/${GROUP_ID}`)) {
        patchCalled = true
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: { id: GROUP_ID, name: 'Grupo Editado', is_admin: true },
          },
        })
      } else {
        await route.continue()
      }
    })

    // 1. Acessar a página de um grupo
    await page.goto(`/grupos/${GROUP_ID}`)

    // 2. Navegar nas abas secundárias
    await page.getByRole('link', { name: /Ranking/i }).click()
    await page.getByRole('link', { name: /Membros/i }).click()

    // 3. Abrir o Menu Kebab. O item "Editar nome" virou "Configurações do grupo" (#517).
    const editMenuText = page.getByRole('menuitem', { name: 'Configurações do grupo' })
    if (!(await editMenuText.isVisible())) {
      await page.getByRole('button', { name: 'Opções do grupo' }).click()
    }

    // 4. Selecionar "Configurações do grupo" e alterar o nome no modal. O modal
    // também tem o bônus de classificado (#517), então o campo vai pelo placeholder.
    await editMenuText.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder('Nome do grupo').fill('Grupo Editado')
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
      } else if (method === 'GET' && url.endsWith(`/${GROUP_ID}`)) {
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: {
              id: GROUP_ID,
              name: 'Grupo Original',
              is_admin: false,
              competition_id: 'comp-1',
              competition_name: 'Brasileirão',
              points_exact: 3,
              points_winner: 1,
              member_count: 2,
            },
          },
        })
      } else {
        await route.continue()
      }
    })

    await page.goto(`/grupos/${GROUP_ID}`)

    // Verificar que não existe edição
    await expect(page.getByText(/Configurações do grupo/i)).not.toBeVisible()

    // Procurar "Sair do grupo"
    const leaveGroupBtn = page.getByText(/Sair do grupo/i)
    if (!(await leaveGroupBtn.isVisible())) {
      await page.getByRole('button', { name: 'Opções do grupo' }).click()
    }

    // Com o menu aberto, o membro comum também não vê a configuração do grupo.
    await expect(page.getByRole('menuitem', { name: 'Configurações do grupo' })).toHaveCount(0)

    await leaveGroupBtn.click()

    // A espera pela resposta começa antes do clique. A resposta mockada pode chegar
    // antes de o clique terminar, e uma espera registrada depois dela não termina.
    const leaveResponse = page.waitForResponse(
      (response) => response.url().includes('/members/user-1') && response.status() === 200,
    )

    // Confirmar saída no modal
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Sair|Confirmar/i })
      .click()

    // Validar deleção
    await leaveResponse
    expect(leaveCalled).toBe(true)
  })
})
