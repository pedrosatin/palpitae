/**
 * Entrada usada apenas na geração do HTML estático, durante o build.
 *
 * Sem ela o servidor entrega `<div id="root"></div>` e mais nada: a landing só
 * existe depois que o bundle baixa, é parseado e o React monta. Era esse o
 * gargalo do LCP no mobile — a imagem do hero terminava de baixar em ~0,6 s,
 * mas só era pintada ~1,9 s depois ("element render delay" na auditoria).
 *
 * Aqui a MESMA árvore que `main.tsx` monta no navegador é renderizada em texto
 * na hora do build, e o cliente apenas hidrata o resultado. Qualquer divergência
 * entre esta árvore e a de `main.tsx` vira erro de hidratação, então as duas
 * precisam ser alteradas juntas.
 *
 * Só a rota "/" é pré-renderizada: é a única pública, a única indexada e a
 * única que não depende da sessão.
 */

import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import App from './App'
import CookieConsent from './components/CookieConsent'

export function render(): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location="/">
        {/* `landingPrerenderizada` faz o App pintar a landing sem esperar o
            /auth/me — é exatamente o estado em que o cliente hidrata. */}
        <App landingPrerenderizada />
        <CookieConsent />
      </StaticRouter>
    </StrictMode>,
  )
}
