import { test, expect } from '@playwright/test';

test.describe('Join Group Flow', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  test('Deve entrar em um grupo usando código de convite', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

    await page.route('**/auth/me', async route => {
      await route.fulfill({
        headers: corsHeaders,
        json: { user: { id: 'user-1', email: 'test@example.com' } }
      });
    });

    await page.route('**/api/competitions**', async route => {
      await route.fulfill({
        headers: corsHeaders,
        json: { competitions: [{ id: 'comp-1', name: 'Brasileirão', slug: 'brasileirao' }] }
      });
    });

    await page.route('**/api/matches**', async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders });
      } else {
        await route.fulfill({ headers: corsHeaders, json: { matches: [], default_round: '1' } });
      }
    });

    await page.route('**/api/predictions**', async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders });
      } else {
        await route.fulfill({ headers: corsHeaders, json: { predictions: [] } });
      }
    });

    let joinCalled = false;

    await page.route('**/api/groups**', async route => {
      const url = route.request().url();
      const method = route.request().method();
      
      if (method === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders });
        return;
      }

      if (url.includes('/join') && method === 'POST') {
        joinCalled = true;
        await route.fulfill({
          headers: corsHeaders,
          json: { group: { id: 'group-2', name: 'Grupo Novo' } }
        });
      } else if (url.includes('/group-2') && method === 'GET') {
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: {
              id: 'group-2', name: 'Grupo Novo', competition_name: 'Brasileirão', is_admin: false, member_count: 2
            }
          }
        });
      } else if (method === 'GET') {
        await route.fulfill({ headers: corsHeaders, json: { groups: [] } });
      } else {
        await route.continue();
      }
    });

    // 1. Acessar o Dashboard logado
    await page.goto('/');

    // 2. Clicar em "Entrar em grupo"
    await page.getByRole('button', { name: /Entrar em grupo/i }).click();

    // 3. Inserir código de convite no Modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.locator('input').first().fill('INVITE123');

    // Submeter o código
    await modal.getByRole('button', { name: /Entrar|Confirmar/i }).click();

    // 4 & 5. Validar chamada de API e redirecionamento
    await expect(page.locator('h1').filter({ hasText: 'Grupo Novo' })).toBeVisible();
    expect(joinCalled).toBe(true);
  });
});
