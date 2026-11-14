import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi } from 'vitest'
import Modal from './Modal'

function renderModal(props?: Partial<Parameters<typeof Modal>[0]>) {
  const defaults = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Test Modal',
    analyticsId: 'criar_grupo' as const,
    children: <p>Modal body</p>,
  }
  return render(<Modal {...defaults} {...props} />)
}

describe('Modal', () => {
  afterEach(() => {
    delete (window as Partial<Window>).gtag
  })

  it('leva o foco para dentro do diálogo ao abrir', () => {
    renderModal()
    expect(screen.getByRole('dialog').firstElementChild).toHaveFocus()
  })

  it('devolve o foco ao elemento que abriu o modal', async () => {
    function Harness({ withInput = false }: { withInput?: boolean }) {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir</button>
          <Modal
            isOpen={open}
            onClose={() => setOpen(false)}
            title="Teste"
            analyticsId="criar_grupo"
          >
            {withInput ? <input aria-label="Campo" autoFocus /> : <p>Corpo</p>}
          </Modal>
        </>
      )
    }
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Abrir' })
    await user.click(opener)
    expect(opener).not.toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(opener).toHaveFocus()
    unmount()

    render(<Harness withInput />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('textbox', { name: 'Campo' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus()
  })

  it('renders nothing when isOpen is false', () => {
    renderModal({ isOpen: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title and children when open', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
    expect(screen.getByText('Modal body')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked and sends fixed analyticsId instead of title', async () => {
    const gtag = vi.fn()
    window.gtag = gtag
    const onClose = vi.fn()
    renderModal({ onClose, title: 'Título Livre Privado', analyticsId: 'palpites_membro' })
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(gtag).toHaveBeenCalledWith('event', 'click_modal_fechar', { modal: 'palpites_membro' })
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('Título Livre Privado')
  })

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose when modal content is clicked', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    await userEvent.click(screen.getByText('Modal body'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
