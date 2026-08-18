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

## Consentimento e LGPD

O GA4 opera através do Consent Mode v2 para respeitar a privacidade dos usuários.
O status da permissão é salvo no `localStorage`:
- **Aceitar:** Modo passa para `granted`, tags são disparadas e o consentimento é armazenado indefinidamente.
- **Recusar:** Modo fica como `denied` e as tags respeitam a falta de cookies. A recusa é salva com um *timestamp* e **expira após 30 dias**. Quando expira, o banner reaparece na próxima visita. Isso garante que não pratiquemos *Consent Fatigue* (re-pedir insistentemente em poucos dias), respeitando a LGPD, mas permitindo re-converter usuários antigos.

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

Eventos da config de pontuação/visibilidade no grupo (CreateGroupModal + MatchCard):

| Evento | Disparo | Params |
|---|---|---|
| `click_create_group_preset_selecionado` | seleção de preset de pontuação | `{ preset }` (`classic`/`exact_only`/`winner_only`/`custom`) |
| `click_create_group_visibilidade_publica` | seleção de visibilidade "Sempre visível" | — |
| `click_create_group_visibilidade_oculta` | seleção de visibilidade "Oculto até palpitar" | — |
| `click_create_group_ajuda_pontuacao` | toque no (i) ao lado de Placar exato/Vencedor | `{ campo }` (`exact`/`winner`) |
| `click_matchcard_resultado` | clique em Casa/Empate/Fora (grupos `points_exact = 0`) | `{ match_id, outcome }` (`home`/`draw`/`away`) |
| `click_prediction_penalty_winner` | seleção do vencedor dos pênaltis num palpite de empate (jogo `decides_on_penalties`) | `{ match_id, winner }` (`home`/`away`) |

> Steppers de placar e a troca de palpite empate→decisivo (que limpa o pick de pênalti)
> seguem **não** rastreados — só o clique intencional no vencedor do pênalti gera evento.

Compartilhamento do convite (`ShareButtons`, usado em GroupInviteSection + CreateGroupSuccessView).
O `<contexto>` é `group_detail` na página do grupo e `create_group` no modal de sucesso:

| Evento | Disparo | Params |
|---|---|---|
| `click_<contexto>_compartilhar` | botão "Compartilhar" (Web Share nativo; sem suporte, copia o link) | — |
| `click_<contexto>_whatsapp` | ícone WhatsApp (abre wa.me com texto + link) | — |
| `click_<contexto>_twitter` | ícone X/Twitter (abre intent/tweet com texto + link) | — |

Dashboard admin de métricas (`/admin/metricas`, AdminMetricsPage):

| Evento | Disparo | Params |
|---|---|---|
| `click_admin_metrics_periodo` | troca do período dos gráficos (7d/30d/90d) | `{ days }` (`7`/`30`/`90`) |
| `click_admin_metrics_arquivo_mes` | seleção de um mês pra analisar o arquivo frio (R2) | `{ month }` (`YYYY-MM`) |

Radar de competições (`/admin/oportunidades`, AdminRadarPage):

| Evento | Disparo | Params |
|---|---|---|
| `click_admin_radar_periodo` | troca do período da análise (7d/30d/90d) | `{ days }` (`7`/`30`/`90`) |
| `click_admin_radar_ordenar` | troca da coluna de ordenação da tabela | `{ sort }` (`interest`/`matches`/`name`) |
| `click_admin_radar_filtrar_em_andamento` | liga/desliga o filtro "só em andamento" | — |
| `click_admin_radar_filtrar_nao_suportadas` | liga/desliga o filtro "só não suportadas" | — |

Modal genérico (componente `Modal`):

| Evento | Disparo | Params |
|---|---|---|
| `click_modal_fechar` | clique no botão ✕ de qualquer modal (backdrop/ESC seguem não rastreados) | `{ modal }` (título do modal) |

Compartilhar resultado de campeonato encerrado (GroupCard + ShareGroupModal):

| Evento | Disparo | Params |
|---|---|---|
| `click_groupcard_compartilhar` | clique em "Compartilhar resultado" no card encerrado (abre o modal) | `{ group_id }` |
| `click_share_compartilhar` | clique em "Compartilhar" no modal (só aparece onde há Web Share de arquivos — mobile) | — |
| `click_share_baixar` | clique em "Baixar imagem" no modal | — |
| `click_share_copiar_link` | clique em "Copiar link" no modal | — |

Rodada com jogo adiado (PredictionsTab — ver ADR-013):

| Evento | Disparo | Params |
|---|---|---|
| `click_predictions_rodada_adiada` | clique em "Ver rodada" no aviso de rodada com jogo adiado (pula para a rodada onde o palpite segue aberto) | `{ round }` |
