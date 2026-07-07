import { test, expect } from '@playwright/test';

test.describe('Landing and Auth Flow', () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  test('Deve acessar página pública e ir para tela de login', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    
    // Simula usuário não autenticado inicialmente
    await page.route('**/auth/me', async route => {
      await route.fulfill({ status: 401, headers: corsHeaders, json: { message: 'Unauthorized' } });
    });

    // 1. Acessar `/` deslogado
    await page.goto('/');
    
    // 2. Verificar visibilidade (usando botão Entrar como referência de landing)
    const btnEntrar = page.getByRole('link', { name: /Entrar/i }).first();
    await expect(btnEntrar).toBeVisible();
    
    // 3. Clicar em "Entrar"
    await btnEntrar.click();
    
    // 4. Validar mudança de rota e botão do Google
    await expect(page).toHaveURL(/.*\/entrar/);
    const googleBtn = page.getByRole('button', { name: /Entrar com Google/i });
    await expect(googleBtn).toBeVisible();

    // 5. Interceptar autenticação simulando sucesso
    await page.route('**/auth/me', async route => {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          user: { id: 'user-1', email: 'test@example.com', feature_flags: {} }
        }
      });
    });

    await page.route('**/api/groups**', async route => {
      await route.fulfill({ headers: corsHeaders, json: { groups: [] } });
    });

    // Simula o callback do OAuth recarregando/navegando para a raiz com a sessão ativa
    await page.goto('/');
    
    // Checar redirecionamento automático para o Dashboard
    await expect(page.locator('h2').filter({ hasText: /Nenhum grupo|Seus grupos/i })).toBeVisible();
  });
});
