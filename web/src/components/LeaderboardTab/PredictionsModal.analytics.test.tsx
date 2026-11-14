import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PredictionsModal from './PredictionsModal'

// Usa o ga.ts real (sem mock); apenas o hook de dados é stubado para evitar rede.
vi.mock('./hooks/useMemberPredictions', () => ({
  useMemberPredictions: () => ({
    modalPredictions: [],
    modalLoading: false,
    modalError: null,
    modalRoundIndex: 0,
    setModalRoundIndex: () => {},
  }),
}))

const otherMember = {
  user_id: 'u-other',
  display_name: 'Fulana Teste',
  avatar_url: null,
  role: 'member',
  joined_at: '2026-01-01T00:00:00Z',
  total_points: 0,
  exact_hits: 0,
}

describe('PredictionsModal analytics (ga.ts real)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    delete (window as Partial<Window>).gtag
  })

  it('consentimento não escolhido envia modal fixo palpites_membro sem nome do membro', async () => {
    const gtag = vi.fn()
    window.gtag = gtag

    render(<PredictionsModal member={otherMember} groupId="g1" onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(gtag).toHaveBeenCalledWith('event', 'click_modal_fechar', {
      modal: 'palpites_membro',
    })
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('Fulana Teste')
  })

  it('consentimento aceito envia modal fixo palpites_membro sem nome do membro', async () => {
    localStorage.setItem('palpitae:analytics-consent', 'granted')
    const gtag = vi.fn()
    window.gtag = gtag

    render(<PredictionsModal member={otherMember} groupId="g1" onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(gtag).toHaveBeenCalledWith('event', 'click_modal_fechar', {
      modal: 'palpites_membro',
    })
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('Fulana Teste')
  })

  it('consentimento negado não envia evento ao gtag', async () => {
    localStorage.setItem('palpitae:analytics-consent', `denied:${Date.now()}`)
    const gtag = vi.fn()
    window.gtag = gtag

    render(<PredictionsModal member={otherMember} groupId="g1" onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(gtag).not.toHaveBeenCalled()
  })
})
