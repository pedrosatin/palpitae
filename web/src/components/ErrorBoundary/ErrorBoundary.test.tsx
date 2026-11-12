import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RouteErrorBoundary } from '.'

const crash = { home: true }

function Home() {
  if (crash.home) throw new TypeError('quebrou')
  return <p>Início</p>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </RouteErrorBoundary>
    </MemoryRouter>,
  )
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    crash.home = true
    // O React registra no console o erro que a fronteira capturou.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('"Voltar para o início" monta a página de novo quando quem quebrou foi a própria /', async () => {
    renderAt('/')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Algo deu errado ao mostrar esta página.',
    )

    crash.home = false
    await userEvent.click(screen.getByRole('link', { name: 'Voltar para o início' }))

    expect(screen.getByText('Início')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
