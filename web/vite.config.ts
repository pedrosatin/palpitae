/// <reference types="vitest" />
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type UserConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { assertBuildEnv } from './build/env'
import { guidesPlugin, sitemapPlugin } from './build/guides'

// https://vitejs.dev/config/
const config: UserConfig = {
  // guidesPlugin emits the static /guias/* content pages; sitemapPlugin emits a
  // sitemap.xml covering the landing page + every guide. Both at build time.
  plugins: [react(), guidesPlugin(), sitemapPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    // tests/e2e são specs do Playwright (`npx playwright test`) — o vitest não
    // sabe executá-los e quebraria o `npm test`.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['./src/test-setup.ts'],
    testTimeout: 10000,
    css: {
      // Deixa o texto de variables.css legível via ?raw em tokens.test.ts.
      include: [/variables\.css/],
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
}

const webRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ command, mode }) => {
  // O build de produção para quando VITE_API_URL ou VITE_AUTH_URL faltam ou estão
  // malformadas. Dev e testes seguem com os padrões de config.ts.
  if (command === 'build' && mode === 'production') assertBuildEnv(loadEnv(mode, webRoot, 'VITE_'))
  return config
})
