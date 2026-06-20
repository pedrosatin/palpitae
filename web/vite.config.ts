/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { guidesPlugin, sitemapPlugin } from './build/guides'

// https://vitejs.dev/config/
export default defineConfig({
  // guidesPlugin emits the static /guias/* content pages; sitemapPlugin emits a
  // sitemap.xml covering the landing page + every guide. Both at build time.
  plugins: [react(), guidesPlugin(), sitemapPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
})
