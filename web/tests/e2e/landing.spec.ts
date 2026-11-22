import { test, expect } from '@playwright/test'

test.describe('Landing and Auth Flow', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  test('Deve acessar página pública e ir para tela de login', async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()))

    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        headers: corsHeaders,
        json: { message: 'Unauthorized' },
      })
    })

    await page.goto('/')

    const btnEntrar = page.getByRole('link', { name: /Entrar/i }).first()
    await expect(btnEntrar).toBeVisible()

    await btnEntrar.click()

    await expect(page).toHaveURL(/.*\/entrar/)
    await expect(page.getByRole('heading', { name: 'Bem-vindo ao Palpitae' })).toBeVisible()
    const googleBtn = page.getByRole('button', { name: /Entrar com Google/i })
    await expect(googleBtn).toBeVisible()

    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          user: { id: 'user-1', email: 'test@example.com', feature_flags: {} },
        },
      })
    })

    await page.route('**/api/groups**', async (route) => {
      await route.fulfill({ headers: corsHeaders, json: { groups: [] } })
    })

    await page.goto('/')

    await expect(page.locator('h2').filter({ hasText: /Nenhum grupo|Seus grupos/i })).toBeVisible()
  })
})
