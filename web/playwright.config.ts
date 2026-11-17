import { defineConfig, devices } from '@playwright/test'

// O aviso de cookies só existe com um id do GA, e ele não pode cobrir os demais testes.
const consentPort = process.env.CONSENT_TEST_PORT || '5174'
const consentUrl = `http://localhost:${consentPort}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Uma nova tentativa grava o trace (`on-first-retry`), mas o teste que só passa
  // nela reprova a execução: instabilidade aparece no PR em vez de ficar escondida.
  retries: 1,
  failOnFlakyTests: true,
  // O runner público do GitHub tem 4 vCPUs. Fora do CI, o padrão do Playwright.
  workers: process.env.CI ? 4 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /cookie-consent-layout/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-consent',
      testMatch: /cookie-consent-layout/,
      use: { ...devices['Desktop Chrome'], baseURL: consentUrl },
    },
  ],
  webServer: [
    {
      command: 'VITE_API_URL=http://localhost:5173/api npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `VITE_GA_MEASUREMENT_ID=${process.env.REAL_GTAG_ID || 'G-TEST123'} VITE_API_URL=${consentUrl}/api VITE_AUTH_URL=${consentUrl} npm run dev -- --port ${consentPort} --strictPort`,
      url: consentUrl,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
