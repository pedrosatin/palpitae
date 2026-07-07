import { test, expect } from '@playwright/test';

test.describe('Settings Flow', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  test('Deve alterar preferências de notificações', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

    await page.route('**/auth/me', async route => {
      await route.fulfill({
        headers: corsHeaders,
        json: { user: { id: 'user-1', email: 'test@example.com' } }
      });
    });

    let patchCalled = false;

    // 2 & 5. Interceptar GET e PATCH das preferências
    await page.route('**/api/notifications/preferences**', async route => {
      const method = route.request().method();
      if (method === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders });
      } else if (method === 'GET') {
        await route.fulfill({
          headers: corsHeaders,
          json: { preferences: { round_reminders: false, promotions: false } }
        });
      } else if (method === 'PATCH') {
        patchCalled = true;
        await route.fulfill({
          headers: corsHeaders,
          json: { preferences: { round_reminders: true, promotions: false } }
        });
      }
    });

    // 1. Acessar `/configuracoes` logado
    await page.goto('/configuracoes');

    // 3. Alterar o checkbox de "Lembretes de rodada"
    const reminderLabel = page.getByText(/Lembretes de rodada/i);
    await reminderLabel.click();

    // 4. Confirmar na modal de aviso
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Confirmar|Sim|Salvar/i }).click();

    // 5. Checar o request e mensagem de sucesso
    expect(patchCalled).toBe(true);
    await expect(page.getByText(/Configuração salva com sucesso|Salvo com sucesso/i)).toBeVisible();
  });
});
