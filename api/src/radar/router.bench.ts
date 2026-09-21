import { describe, bench } from 'vitest'
import { radarRouter } from './router'
import { Hono } from 'hono'

// Create a mock environment
const MOCK_COMPETITIONS = Array.from({ length: 500 }, (_, i) => ({
  id: `comp_${i}`,
  name: `Competition ${i}`,
  country: `Country ${i % 10}`,
  type: 'league',
  logo_url: null,
  season: '2024',
  starts_on: null,
  ends_on: null,
  wiki_article: null,
}))

const MOCK_DAILY = Array.from({ length: 500 * 30 }, (_, i) => ({
  radar_id: `comp_${Math.floor(i / 30)}`,
  day: `2024-01-${(i % 30) + 1}`,
  matches_today: 0,
  pageviews: 100,
}))

const MOCK_GROUPS = Array.from({ length: 2000 }, (_, i) => ({
  slug: `country-${i % 10}-competition-${Math.floor(i / 4)}-2024`,
  groups: 5,
}))

describe('radar router benchmark', () => {
  bench('GET /', async () => {
    const app = new Hono()
    app.route('/', radarRouter)

    const req = new Request('http://localhost/')
    // ... we actually can't easily mock the DB without vitest setup...
    // Let's just create a standalone benchmark file with the function logic.
  })
})
