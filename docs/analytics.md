# Analytics — eventos de clique (GA4, lado cliente)

Como o Palpitae rastreia **intenção do usuário no cliente**: cliques, navegação, envios de
formulário. É o par cliente do server-side (ver [`observability.md`](observability.md)): o GA
cobre o funil de aquisição/uso; eventos de negócio com número completo são server-side.

## Regra

Sempre que adicionar ou modificar um elemento clicável (`button`, `Link`, `a`, ou qualquer
elemento com `onClick`), adicione um `trackEvent()` correspondente.

```ts
import { trackEvent } from '../../analytics/ga'

// botão
<button onClick={() => { trackEvent('click_<contexto>_<acao>'); doSomething() }}>

// link
<Link to="/rota" onClick={() => trackEvent('click_<contexto>_<acao>')}>
```

**Helper:** `web/src/analytics/ga.ts` → `trackEvent(name, params?)`.

## Convenções de nome

- snake_case; prefixo `click_` para cliques, `submit_` para envios de formulário bem-sucedidos
- padrão: `click_<página/componente>_<ação>` — ex: `click_header_logout`, `click_group_detail_tab`
- o token de **contexto** (página/componente) é em **inglês** (nome do componente:
  `group_detail`, `create_group`, `predictions`); a **ação** é em **português**
  (`copiar_codigo`, `ver_palpites`)
- inclua params quando útil para segmentação: `{ tab }`, `{ group_id }`, `{ round }`, `{ count }`

## O que rastrear vs. ignorar

- ✅ Rastrear: toda ação intencional do usuário (navegar, abrir modal, salvar, copiar, confirmar)
- ❌ Ignorar: steppers de placar (−/+ no MatchCard) — volume alto, baixo valor analítico
- ❌ Ignorar: fechamento de modal via backdrop/ESC — ruído sem intenção clara

## Eventos já mapeados

Ver a tabela no commit de instrumentação (2026-06-19).
