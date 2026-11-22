import { test, expect } from '@playwright/test'

const GROUP_ID = '00000000-0000-4000-8000-0000000000b1'

test.describe('Happy Path - Palpitae', () => {
  test('Criar grupo, alterar rodada e fazer palpite em bulk', async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()))
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message))
    page.on('requestfailed', (request) =>
      console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText),
    )

    const corsHeaders = {
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          user: {
            id: 'user-1',
            email: 'test@example.com',
            feature_flags: { create_group: true },
          },
        },
      })
    })

    let groupCreated = false
    await page.route('**/api/groups**', async (route) => {
      const url = route.request().url()
      console.log('MOCK INTERCEPT GROUPS:', route.request().method(), url)
      if (route.request().method() === 'OPTIONS') {
        console.log('FULFILL OPTIONS GROUPS')
        await route.fulfill({ status: 200, headers: corsHeaders })
      } else if (route.request().method() === 'GET') {
        if (url.includes(`/groups/${GROUP_ID}`)) {
          await route.fulfill({
            headers: corsHeaders,
            json: {
              group: {
                id: GROUP_ID,
                name: 'Os Craques do Bairro',
                competition_id: 'comp-1',
                competition_name: 'Brasileirão',
                is_admin: true,
                invite_code: 'CODE123',
                created_at: new Date().toISOString(),
                points_exact: 3,
                points_winner: 1,
                predictions_visibility: 'hidden',
                member_count: 1,
                user_position: 1,
                user_points: 0,
                exact_hits: 0,
              },
            },
          })
        } else if (!groupCreated) {
          console.log('MOCK RETURN: groups: []')
          await route.fulfill({
            headers: corsHeaders,
            json: { groups: [], matched_invite_group_id: null },
          })
        } else {
          console.log('MOCK RETURN: groups: [Os Craques do Bairro]')
          await route.fulfill({
            headers: corsHeaders,
            json: {
              groups: [
                {
                  id: GROUP_ID,
                  name: 'Os Craques do Bairro',
                  competition_id: 'comp-1',
                  stats: { members: 1, my_rank: 1, my_points: 0 },
                },
              ],
              matched_invite_group_id: null,
            },
          })
        }
      } else if (route.request().method() === 'POST') {
        groupCreated = true
        await route.fulfill({
          headers: corsHeaders,
          json: {
            group: {
              id: GROUP_ID,
              name: 'Os Craques do Bairro',
              invite_code: 'CODE123',
            },
          },
        })
      } else {
        await route.continue()
      }
    })

    await page.route('**/api/competitions**', async (route) => {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          competitions: [
            {
              id: 'comp-1',
              name: 'Brasileirão',
              slug: 'brasileirao',
              status: 'active',
              season: '2026',
            },
          ],
        },
      })
    })

    await page.route('**/api/matches**', async (route) => {
      console.log('MOCK INTERCEPT MATCHES:', route.request().method(), route.request().url())
      if (route.request().method() === 'OPTIONS') {
        console.log('FULFILL OPTIONS MATCHES')
        await route.fulfill({ status: 200, headers: corsHeaders })
        return
      }
      const tomorrow = new Date(Date.now() + 86400000).toISOString()
      await route.fulfill({
        headers: corsHeaders,
        json: {
          matches: [
            {
              id: 'match-1',
              external_id: '1',
              provider: 'test',
              competition_id: 'comp-1',
              start_time: tomorrow,
              status: 'pending',
              round: '1',
              round_label: 'Rodada 1',
              home_team_id: 'team-1',
              home_team_name: 'Time Casa 1',
              home_team_short_name: 'TC1',
              home_team_logo: '',
              away_team_id: 'team-2',
              away_team_name: 'Time Fora 1',
              away_team_short_name: 'TF1',
              away_team_logo: '',
            },
            {
              id: 'match-2',
              external_id: '2',
              provider: 'test',
              competition_id: 'comp-1',
              start_time: tomorrow,
              status: 'pending',
              round: '2',
              round_label: 'Rodada 2',
              home_team_id: 'team-3',
              home_team_name: 'Time Casa 2',
              home_team_short_name: 'TC2',
              home_team_logo: '',
              away_team_id: 'team-4',
              away_team_name: 'Time Fora 2',
              away_team_short_name: 'TF2',
              away_team_logo: '',
            },
          ],
          default_round: '1',
        },
      })
    })

    await page.route('**/api/predictions**', async (route) => {
      console.log('MOCK INTERCEPT PREDICTIONS:', route.request().method(), route.request().url())
      if (route.request().method() === 'OPTIONS') {
        console.log('FULFILL OPTIONS PREDICTIONS')
        await route.fulfill({ status: 200, headers: corsHeaders })
        return
      }
      await route.fulfill({
        headers: corsHeaders,
        json: {
          predictions: [],
        },
      })
    })

    await page.route('**/api/predictions/bulk', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: corsHeaders })
      } else {
        await route.fulfill({
          headers: corsHeaders,
          json: {
            saved: ['match-1'],
          },
        })
      }
    })

    await page.goto('/')

    await expect(page.locator('h2').filter({ hasText: 'Nenhum grupo ainda' })).toBeVisible()

    await page.getByRole('main').getByRole('button', { name: 'Criar grupo' }).click()
    await expect(page.locator('h2').filter({ hasText: 'Criar grupo' })).toBeVisible()

    await page.fill('input[id="group-name"]', 'Os Craques do Bairro')

    await page.getByRole('dialog').getByRole('button', { name: 'Criar grupo' }).click()

    await expect(page.locator('h3').filter({ hasText: 'Grupo criado!' })).toBeVisible()

    await page.click('button:has-text("Pronto")')

    await expect(page.locator('h2').filter({ hasText: 'Seus grupos' })).toBeVisible()

    await page.getByRole('link', { name: /Os Craques do Bairro/ }).click()

    await page.click('a:has-text("Palpitar")')

    await expect(page.locator('select')).toHaveValue('1')

    await page.click('button[aria-label="Próxima rodada"]')
    await expect(page.locator('select')).toHaveValue('2')

    await page.click('button[aria-label="Rodada anterior"]')
    await expect(page.locator('select')).toHaveValue('1')

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('2')
    await inputs.nth(1).fill('1')

    await page.click('button:has-text("Salvar todos")')

    await expect(page.locator('button:has-text("Tudo salvo!")')).toBeVisible()

    await expect(inputs.nth(0)).toHaveValue('2')
    await expect(inputs.nth(1)).toHaveValue('1')
  })
})
