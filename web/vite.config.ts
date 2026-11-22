/// <reference types="vitest" />
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type UserConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { assertBuildEnv } from './build/env'
import { guidesPlugin, sitemapPlugin } from './build/guides'

const webRoot = fileURLToPath(new URL('.', import.meta.url))

const config: UserConfig = {
  plugins: [react(), guidesPlugin(), sitemapPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['./src/test-setup.ts'],
    execArgv: ['--no-experimental-webstorage'],
    forceRerunTriggers: [
      'package.json',
      'package-lock.json',
      'vite.config.ts',
      'tsconfig*.json',
      'functions/tsconfig.json',
      'src/test-setup.ts',
      '.env*',
      'src/styles/variables.css',
      'scripts/test-changed.sh',
      '../.github/workflows/deploy-web.yml',
    ].map((path) => resolve(webRoot, path)),
    testTimeout: 10000,
    css: {
      include: [/variables\.css/],
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') assertBuildEnv(loadEnv(mode, webRoot, 'VITE_'))
  return config
})
