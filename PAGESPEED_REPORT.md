# Relatório PageSpeed Insights — palpitae.com.br

Gerado em 2026-08-17 via PageSpeed Insights API (Lighthouse 13.4.1).

## Scores atuais

| Categoria | Mobile | Desktop |
|---|---|---|
| Performance | 77 | 97 |
| Accessibility | 100 | 100 |
| Best Practices | 96 | 96 |
| SEO | 100 | 100 |

Acessibilidade e SEO perfeitos. Performance mobile é o ponto crítico (77) — LCP e FCP estão ruins no mobile.

## Problemas encontrados (por prioridade)

### 1. LCP e FCP ruins no mobile (LCP 4.3s, FCP 3.0s)
Maior causa raiz combinada dos itens abaixo (JS não utilizado, CSS render-blocking, imagens pesadas). Não é um item isolado — resolver os itens 2-4 deve corrigir isso.

### 2. JavaScript não utilizado — Google Tag Manager (~68 KiB desperdiçados) ✅ Corrigido
`gtag.js` do Google Tag Manager carrega 165 KB mas só ~half é usado no carregamento inicial, e ele não é essencial para renderizar a página.

**Correção:** carregar o GTM de forma assíncrona/adiada (`defer`, ou disparar via `requestIdleCallback`/depois do primeiro input), ou considerar Partytown para rodar o script em web worker fora da main thread.

**Implementado:** `web/src/analytics/ga.ts` agora separa o stub síncrono do `gtag`/Consent Mode (necessário cedo, antes do render) da injeção da tag `<script>` real, que só acontece após o evento `load` da página e via `requestIdleCallback` (com fallback `setTimeout`). Nenhum hit é perdido — o stub já enfileira tudo em `dataLayer`.

### 3. Erro 401 no console — `/api/auth/me` (Best Practices) ✅ Corrigido
Toda visita anônima gera um `401 Unauthorized` logado no console ao verificar sessão do usuário.

**Correção:** se o 401 é esperado para usuário deslogado, evitar que ele apareça como erro no console — trate a resposta 401 como caso esperado no client (não deixe o `fetch`/lib de HTTP logar automaticamente), ou use um endpoint/rota que retorne 200 com `{authenticated: false}` em vez de 401 para essa checagem específica.

**Implementado:** `GET /auth/me` (`api/src/auth/router.ts`) não usa mais o middleware `requireAuth` — ele lê e valida a sessão internamente e responde `200 { authenticated: false }` quando não há cookie ou o token é inválido/expirado, em vez de `401`. Sessão válida continua respondendo `200 { user }`; usuário com sessão válida mas removido do banco continua `404` (caso já coberto por teste). O client (`web/src/App.tsx`) foi ajustado para interpretar as duas formas do corpo da resposta.

### 4. Imagens de screenshots superdimensionadas (~40 KiB de desperdício) ✅ Corrigido
`screenshots/palpites.webp` e `screenshots/grupos.webp` são maiores do que o exibido.

**Correção:** redimensionar para o tamanho real de exibição (ou `srcset` responsivo) antes de subir os assets.

**Implementado:** `grupos.png`/`.webp` e `palpites.png`/`.webp` foram redimensionados de 1336×717/1297×840 para 1100×590/1100×712 (a maior largura realmente renderizada, cobrindo telas 2x), com paleta indexada nos PNGs de fallback para reduzir ainda mais o peso. `LandingPage.tsx` foi atualizado com os novos `width`/`height` intrínsecos para não introduzir CLS.

### 5. CSS render-blocking (~160ms) ✅ Corrigido
`useDocumentTitle-*.css` e `index-*.css` bloqueiam o first paint.

**Correção:** dividir CSS crítico inline vs. não crítico assíncrono, ou revisar code-splitting do bundler para não gerar CSS-only chunks bloqueantes desnecessários.

**Implementado:** `LoginPage` (rota `/entrar`, nunca renderizada na `/` pública que o Lighthouse audita) virou `lazy()` em `web/src/App.tsx`, como as demais páginas autenticadas — antes era importada de forma eager e puxava seu CSS module (e o chunk compartilhado com `useDocumentTitle`) para dentro do bundle/CSS crítico da landing. Após a mudança, o build só emite `index-*.css` (~9.8 KB) como `<link rel="stylesheet">` bloqueante no `<head>`; o CSS de `LoginPage` vira um chunk separado, carregado sob demanda.

### 6. Cache lifetimes e image-delivery (baixo impacto, poucos KiB)
Não implementado nesta rodada — item de baixo impacto, deixado para uma iteração futura (ajuste de `Cache-Control` nos assets estáticos servidos pelo Worker/Pages).

## Meta
Resolver os itens 2, 4 e 5 deve trazer o Performance mobile de 77 para a faixa de 90+, aproximando do desktop (97).
