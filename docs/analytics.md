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
- **Recusar:** Modo passa para `denied` e o cliente interrompe o envio de dados. A recusa é salva com um timestamp e expira após 30 dias. Quando expira, o banner reaparece na próxima visita.

### Alterar ou revogar a escolha

O rodapé do app, dos guias e do índice de guias tem o botão "Preferências de
cookies". Ele reabre o aviso existente. "Recusar" salva `denied:<timestamp>`,
ativa `window['ga-disable-<measurement id>']` e manda `consent update` com
`analytics_storage: denied`. Se o cliente desta página rodou com `granted`,
recarrega a página, porque a flag em tempo de execução não para os eventos
automáticos do cliente. A recarga só ocorre se a gravação da recusa deu certo.
A recusa também expira `_ga` e o cookie `_ga_<id sem G->` no host e nos domínios
pais. Os helpers de eventos e navegação param de enfileirar hits; o contexto da
página continua atualizado com `set`. "Aceitar" libera o cliente de novo.
Com storage bloqueado, a página não recarrega e os helpers seguem a recusa em
memória até a pessoa sair da página. A escolha não persiste entre carregamentos.
Exceção à regra acima: os botões do aviso e de preferências não chamam `trackEvent`.

Para conferir em ambiente local com um id de teste:

1. Recuse no aviso, abra as preferências, aceite e revogue novamente.
2. Na aba Rede, filtre por `collect`. Depois da revogação e da recarga, role a
   página e navegue: nenhuma requisição `g/collect` deve aparecer. Em Aplicativo >
   Cookies, confira que `_ga` e `_ga_<id>` sumiram.
3. Recarregue e confira a recusa salva, com o aviso fechado. Repita na SPA e
   em `/guias/bolao-do-brasileirao/`, em celular e desktop.

Na manutenção da propriedade GA4, confira em Fluxos de dados > Web > Medição
otimizada > Visualizações de página > Configurações avançadas que a opção de
mudanças de página por eventos do histórico do navegador continua desligada.
O app envia navegação com URLs filtradas. A medição automática por histórico
pode enviar a URL original, com parâmetros privados, e não deve ser habilitada.
A validação local não comprova essa configuração do painel.

A página `/privacidade` ainda não existe. Quando existir, deve apontar para este botão.

### Páginas estáticas (`/guias/`)

Os guias são HTML gerado no build (`web/build/guides.ts`), sem o bundle React, então não
chamam `initGa()` nem montam o `CookieConsent`. O `web/build/analytics.ts` injeta um script
inline equivalente no `<head>` de cada guia e do índice: registra o `consent default`
(tudo `denied`) antes de `js`/`config`, restaura a escolha salva,
com `ga-disable` quando ela é `denied`, carrega o gtag.js no idle depois do `load`
e mostra o mesmo aviso quando não há escolha salva ou quando a pessoa clica em
"Preferências de cookies". Chave e formato
do `localStorage` são os mesmos do app, então a escolha feita num guia vale na landing e
vice-versa. Sem `VITE_GA_MEASUREMENT_ID`, nada é emitido. Qualquer mudança em `ga.ts` ou no
`CookieConsent` precisa ser replicada em `build/analytics.ts`. Os testes de
`web/build/guides.test.ts` não comparam os dois.

### Origem dos guias no funil

Os CTAs enviam `from=guia_<slug>`, `guia_<slug>_header` ou `guias_header` na URL
de `/entrar`. O App captura esse token antes de resolver a autenticação, inclusive
para quem já está logado e será redirecionado para o dashboard. A chegada a
`/entrar` gera `entrar_origem` uma vez por navegação. O retorno do OAuth em `/`
preserva a atribuição e não gera outra chegada.

O guia do Brasileirão também envia `competicao=campeonato-brasileiro-serie-a-2027`
no CTA principal e no "Criar bolão" do topo. O campo é `competitionSlug` em
`web/build/guides.ts`. Quem já tem sessão vai de `/entrar` para `/` com a mesma
query, e quem entra pelo Google volta com ela pelo `redirect`. Na montagem, o
painel abre o formulário de criação com essa competição escolhida e tira só o
`competicao` da URL, com `replace`. Se a competição não está na lista
selecionável, por falta de cadastro ou por estar encerrada, o formulário fica na
primeira e mostra um aviso junto do select. Fechar o modal descarta o pedido.
Voltar no histórico até `/entrar` não reabre o formulário, porque o redirect de
quem tem sessão tira o `competicao` quando a carga da página vem do histórico. O
painel ignora valor fora do formato de slug, feito de minúsculas, números e
hífens, acima de 100 caracteres ou repetido. Também ignora o parâmetro junto de
`convite` e para quem não pode criar grupo. O `competicao` não vai ao GA4, porque
`web/src/analytics/pageContext.ts` só deixa passar `utm_*`, `gclid`, `from` e
`tab` na query.

`web/src/analytics/guideOrigin.ts` aceita apenas esses formatos, com slug em
minúsculas, letras ASCII, números e hífens, até 12 partes e 100 caracteres no
token completo. Essa validação limita valores vindos da URL sem importar o código
de build no app. Ela valida o formato, sem confirmar a existência do guia.
Parâmetro duplicado ou inválido apaga a origem anterior.

A origem fica em `sessionStorage` por uma hora desde a última URL com token
válido. Esse prazo permite concluir o OAuth e criar o bolão sem atribuir outras
visitas na mesma aba indefinidamente. Navegação sem `from` mantém a origem dentro
desse prazo. Logout e logout de todos os dispositivos apagam a atribuição.
Storage bloqueado permite navegar normalmente, com atribuição de conversão
indisponível. O Consent Mode continua controlando a coleta pelo GA4.

`login` e `submit_criar_grupo` incluem `{ origem }` quando há atribuição válida.
A criação só gera evento após sucesso da API. Os nomes dos eventos anteriores
foram preservados. Para segmentar relatórios por `origem`, confira a dimensão
personalizada correspondente na propriedade GA4. A implementação local não
comprova sua configuração ou o recebimento dos eventos em produção.

### Origem do cadastro

Além do GA4, o clique em "Entrar com Google" leva uma categoria à API no parâmetro `origem`, usada
só se a conta for nova (ver "Origem do cadastro" em [`observability.md`](observability.md)). A regra
do navegador fica em `web/src/analytics/signupOrigin.ts`, e a prioridade é convite, guia, chegada da
aba.

- **Convite:** abrir `/convite/<código>` ou `?convite=<código>` com formato válido marca a aba, por
  cima de uma chegada anterior.
- **Guia:** o token da seção anterior, enquanto valer a uma hora. Quem chega ao app a partir de uma
  página de guia sem token (o logo ou o link "Início") é atribuído pelo caminho do referrer, com a
  mesma validade de uma hora e por cima de uma chegada já registrada.
- **Chegada da aba:** na primeira página da aba, o `document.referrer` vira `busca` (lista de
  buscadores), `direto` (sem referrer) ou nada (outro site). Fica no `sessionStorage` sem prazo, e a
  volta do OAuth não sobrescreve. `accounts.google.com` não é busca.

O referrer em si nunca sai do navegador, e sem categoria a API registra `desconhecida`. Logout e
logout de todos os dispositivos apagam a atribuição. O valor não passa pelo Consent Mode, porque não
identifica a pessoa e não vai ao GA4.

## Dados privados e `page_view`

`web/src/analytics/pageContext.ts` define a URL e o título enviados ao GA. Grupo vira `/grupos/:id` com título `Grupo | Palpitae`, convite vira `/convite/:code`, e a query string mantém só a lista permitida (`utm_*`, `gclid`, `from`, `tab`). O título da aba continua com o nome do grupo.

O primeiro carregamento sai pelo `config`. A navegação interna sai pelo `page_view` manual de `useGaPageView`, porque o `page_view` automático de mudança de histórico ignora `page_location`. Por isso a opção **Page changes based on browser history events** da medição aprimorada fica desligada no fluxo Palpitae. **Form interactions** também fica desligada: o `form_start` automático envia a URL real em `form_destination`, e formulário se mede com os eventos `submit_*`. **Site search** também fica desligada: o `view_search_results` automático lê parâmetros como `q` direto da URL, antes da normalização, e o app não tem busca.

## Convenções de nome

- snake_case; prefixo `click_` para cliques, `submit_` para envios de formulário bem-sucedidos
- padrão: `click_<página/componente>_<ação>` — ex: `click_header_logout`, `click_group_detail_tab`
- o token de **contexto** (página/componente) é em **inglês** (nome do componente:
  `group_detail`, `create_group`, `predictions`); a **ação** é em **português**
  (`copiar_codigo`, `ver_palpites`)
- inclua params quando útil para segmentação: `{ tab }`, `{ round }`, `{ count }`. Nunca envie nome, id de grupo ou código de convite

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
| `click_create_group_visibilidade_oculta` | seleção de visibilidade "Oculto até o jogo começar" | — |
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
| `click_<contexto>_whatsapp` | ícone WhatsApp (abre wa.me com texto + link). Em `create_group`, é o botão principal "Chamar a galera no WhatsApp" (menu nativo no celular, wa.me no desktop). | — |
| `click_<contexto>_twitter` | ícone X/Twitter (abre intent/tweet com texto + link) | — |

Fechamento do modal de sucesso da criação do grupo (`CreateGroupSuccessView`):

| Evento | Disparo | Params |
|---|---|---|
| `click_create_group_pronto` | botão "Pronto", última ação do modal | — |

Quem já palpitou e lembrete na aba Grupo (`GroupPicksTab`):

| Evento | Disparo | Params |
|---|---|---|
| `click_group_picks_ver_quem_palpitou` | toque na contagem de um jogo aberto, que mostra ou esconde os nomes | `{ open }` |
| `click_group_picks_lembrete_whatsapp` | botão "Lembrar no WhatsApp" (menu nativo no celular, wa.me no desktop). Fica fora de `share_invite`, porque a mensagem não é convite. | — |

Convite na página do grupo (`GroupInviteSection`, só para o admin). No celular o convite começa
recolhido numa linha "Convidar membros", exceto quando o dono é o único membro. Nesse caso ele já
vem aberto, e recolher também gera o evento abaixo:

| Evento | Disparo | Params |
|---|---|---|
| `click_group_detail_abrir_convite` | toque na linha "Convidar membros" no celular, que abre ou recolhe o código e o link | `{ open }` (`true` ao abrir, `false` ao recolher) |

Eventos de sucesso do funil de convite (`web/src/analytics/funnel.ts`). Os `click_*` acima
medem a tentativa; estes medem a ação concluída. `login` e `join_group` são eventos
recomendados do GA4.

| Evento | Disparo | Params |
|---|---|---|
| `login` | Volta do OAuth com sessão válida. O clique em "Entrar com Google" grava uma marca no `sessionStorage`, e o `/auth/me` a consome. | `{ method }` (`google`) |
| `share_invite` | convite compartilhado: menu nativo concluído, link ou código copiado, WhatsApp/X aberto com o texto pronto | `{ method, context }` (`native`/`copy_link`/`copy_code`/`whatsapp`/`twitter`; `create_group`/`group_detail`) |
| `join_group` | `POST /groups/join` respondeu 200. Dispara junto com `submit_entrar_grupo`, que continua sendo enviado para não quebrar a série histórica. | `{ entry_method }` (`convite_link` quando o código enviado veio de `/convite/<código>`, `convite_antigo` quando veio de um link antigo com `?convite=`, `codigo` quando foi digitado ou colado no modal) |

O link de convite é `https://palpitae.com.br/convite/<CODE>`. A Pages Function
`web/functions/convite/[code].ts` monta o preview (título e descrição com o grupo). Na SPA, o
visitante vê a página de convite e quem tem sessão vai para `/?convite=<CODE>`. Links antigos com
`?convite=` continuam funcionando. Crawlers de preview e pessoas disparam a busca em
`GET /public/invites/:code`, cacheada no edge por 5 min no 200 e por 1 min no 404. No GA4 a abertura
do link continua sem evento, e quem aceita o convite aparece em `click_login_google` e `join_group`.
A abertura é medida no servidor, com o evento `invite_opened`, uma por navegação e sem crawlers de
preview (ver "Funil de convite" em [`observability.md`](observability.md)).

Dashboard admin de métricas (`/admin/metricas`, AdminMetricsPage):

| Evento | Disparo | Params |
|---|---|---|
| `click_admin_metrics_periodo` | troca do período dos gráficos (7d/30d/90d) | `{ days }` (`7`/`30`/`90`) |
| `click_admin_metrics_arquivo_mes` | seleção de um mês pra analisar o arquivo frio (R2) | `{ month }` (`YYYY-MM`) |
| `click_admin_metrics_filtro_campeonato` | troca de filtro da lista de grupos por campeonato | `{ filter, value }` (`visibility`: `all`/`public`/`pilot`; `status`: `all`/`ongoing`/`upcoming`/`finished`) |
| `click_admin_metrics_tentar_novamente` | "Tentar novamente" depois de falha ao carregar o período selecionado | — |

Radar de competições (`/admin/oportunidades`, AdminRadarPage):

| Evento | Disparo | Params |
|---|---|---|
| `click_admin_radar_periodo` | troca do período da análise (7d/30d/90d) | `{ days }` (`7`/`30`/`90`) |
| `click_admin_radar_ordenar` | troca da coluna de ordenação da tabela | `{ sort }` (`interest`/`matches`/`name`/`start`) |
| `click_admin_radar_filtrar_status` | recorte por status da competição | `{ status }` (`ongoing`/`upcoming`/`all`) |
| `click_admin_radar_filtrar_nao_suportadas` | liga/desliga o filtro "só não suportadas" | — |
| `click_admin_radar_tentar_novamente` | "Tentar novamente" depois de falha ao carregar o período selecionado | — |

Modal genérico (componente `Modal`):

| Evento | Disparo | Params |
|---|---|---|
| `click_modal_fechar` | clique no botão ✕ de qualquer modal (backdrop/ESC seguem não rastreados) | `{ modal }` (título do modal) |

Compartilhar resultado de campeonato encerrado (GroupCard + ShareGroupModal):

| Evento | Disparo | Params |
|---|---|---|
| `click_groupcard_compartilhar` | clique em "Compartilhar resultado" no card encerrado (abre o modal) | — |
| `click_share_compartilhar` | clique em "Compartilhar" no modal (só aparece onde há Web Share de arquivos — mobile) | — |
| `click_share_baixar` | clique em "Baixar imagem" no modal | — |
| `click_share_copiar_link` | clique em "Copiar link" no modal | — |

Rodada com jogo adiado ou remarcado (PredictionsTab — ver ADR-013 e ADR-019):

| Evento | Disparo | Params |
|---|---|---|
| `click_predictions_rodada_adiada` | clique em "Ver rodada" no aviso de rodada com jogo adiado ou remarcado (pula para a rodada onde o palpite segue aberto) | `{ round }` |
