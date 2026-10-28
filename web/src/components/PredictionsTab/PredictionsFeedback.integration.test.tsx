import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import { makeMatch } from '../matchFixtures'
import PredictionsTab from './PredictionsTab'

const originalKey = config.tbbcSiteKey

function serveSave({ saved = ['m1'], failed = false } = {}) {
  const matches = [makeMatch({ id: 'm1', round: '1', status: 'scheduled' })]
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = String(url)
    if (init?.method === 'PUT') {
      return new Response(JSON.stringify(failed ? { error: 'Save failed' } : { saved }), {
        status: failed ? 500 : 200,
      })
    }
    if (path.includes('/matches')) {
      return new Response(JSON.stringify({ matches, default_round: '1' }))
    }
    if (path.includes('/predictions')) {
      return new Response(JSON.stringify({ predictions: [] }))
    }
    if (path.includes('/groups')) return new Response(JSON.stringify({ groups: [] }))
    throw new Error(`Unexpected fetch ${path}`)
  })
}

describe('feedback after confirmed prediction persistence', () => {
  beforeEach(() => {
    Object.assign(config, { tbbcSiteKey: 'k_test' })
  })
  afterEach(() => {
    Object.assign(config, { tbbcSiteKey: originalKey })
    vi.restoreAllMocks()
  })

  it('offers feedback after saving an individual prediction, without contacting TBBC yet', async () => {
    const fetch = serveSave()
    render(<PredictionsTab groupId="private-group" competitionId="c1" />)
    const save = await screen.findByRole('button', { name: /^Salvar$/i })
    expect(screen.queryByText('Foi fácil salvar seus palpites?')).not.toBeInTheDocument()
    await userEvent.click(save)
    expect(await screen.findByText('Foi fácil salvar seus palpites?')).toBeVisible()
    expect(fetch.mock.calls.some(([url]) => String(url).includes('tbbc.app'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(screen.queryByText('Foi fácil salvar seus palpites?')).not.toBeInTheDocument()
  })

  it('does not offer feedback when saving an individual prediction fails', async () => {
    serveSave({ failed: true })
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: /^Salvar$/i }))
    await screen.findByText('Save failed')
    expect(screen.queryByText('Foi fácil salvar seus palpites?')).not.toBeInTheDocument()
  })

  it.each([
    ['confirmed save', ['m1'], true],
    ['empty result', [], false],
    ['unrelated saved id', ['other-match'], false],
  ])('uses actual saved IDs for bulk %s', async (_name, saved, show) => {
    serveSave({ saved })
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aumentar placar Brasil' }))
    const saveAll = await screen.findByRole('button', { name: /Salvar todos \(1\)/i })
    await userEvent.click(saveAll)
    await screen.findByRole('button', { name: 'Tudo salvo!' })
    if (show) expect(await screen.findByText('Foi fácil salvar seus palpites?')).toBeVisible()
    else expect(screen.queryByText('Foi fácil salvar seus palpites?')).not.toBeInTheDocument()
  })

  it('does not offer feedback when a bulk save fails', async () => {
    serveSave({ failed: true })
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Aumentar placar Brasil' }))
    await userEvent.click(await screen.findByRole('button', { name: /Salvar todos \(1\)/i }))
    await screen.findByText('Save failed')
    expect(screen.queryByText('Foi fácil salvar seus palpites?')).not.toBeInTheDocument()
  })

  it('keeps feedback hidden without a key even after a successful save', async () => {
    Object.assign(config, { tbbcSiteKey: '' })
    serveSave()
    render(<PredictionsTab groupId="g1" competitionId="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: /^Salvar$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Salvo/i })).toBeVisible())
    expect(screen.queryByText('Foi fácil salvar seus palpites?')).not.toBeInTheDocument()
  })
})
