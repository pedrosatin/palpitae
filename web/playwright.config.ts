import { defineConfig, devices } from '@playwright/test'

// O aviso de cookies só existe com um id do GA, e ele não pode cobrir os demais testes.
const consentPort = process.env.CONSENT_TEST_PORT || '5174'
const consentUrl = `http://localhost:${consentPort}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
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
