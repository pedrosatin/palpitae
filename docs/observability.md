# Observabilidade — logs, métricas e eventos

Como o Palpitae observa o **lado servidor**: logs operacionais, métricas de saúde e
eventos de negócio. Para **product analytics** (GA4, lado cliente) ver o trabalho de SEO.

A stack é 100% Cloudflare e o princípio é **custo zero com retenção útil**: o que é grátis
nativamente cobre tudo; nada de serviço externo pago.

## As 3 camadas (não confundir)

| Camada | Pergunta que responde | Ferramenta |
|---|---|---|
| Product analytics | de onde vem o tráfego, quem converte | GA4 (cliente) |
| Business events | quantos palpites/grupos, logins | Analytics Engine + R2 (servidor) |
| Operacional/health | o cron rodou? cota estourou? erro? | Workers Logs + Analytics Engine |

**Insight-chave:** métrica de negócio de verdade é **server-side**. Palpite salvo, grupo
criado e login acontecem na API → logamos lá e temos o número **completo**, sem depender de
consentimento nem de adblocker. O GA fica só pro funil de aquisição (lado cliente).

## Arquitetura

### Workers Logs — debug operacional
`[observability]` ligado no `api/wrangler.toml`. Zero código: `console.*` viram
pesquisáveis no dashboard (Free: ~200 mil eventos/dia, retenção 3 dias). Uso: investigar
"o que quebrou no deploy de ontem". **Não** é métrica histórica — para isso, Analytics Engine.

### Analytics Engine — hot path (retenção ~3 meses)
No Worker: `env.AE.writeDataPoint({ blobs, doubles, indexes })`. Escrita assíncrona, **não
adiciona latência** ao request; disponível no plano Free (com sampling automático se
estourar). Consulta via **SQL API** (HTTP, autenticado por token de conta) para dashboards e
debug ad-hoc. Modelo fixo do data point: até 20 `blobs` (strings/dimensões), até 20 `doubles`
(números/medidas), 1 `index` (chave de sampling — usamos o `event_type`).

**Sampling (atenção ao agregar).** Quando o volume estoura, o Analytics Engine **amostra**:
guarda só uma fração das linhas e marca cada linha sobrevivente com `_sample_interval > 1`
(quantas linhas reais aquela representa). Sem sampling, `_sample_interval == 1`. Consequência:
um arquivo NDJSON arquivado é, nesse cenário, uma **amostra, não a verdade completa**. Ao
agregar a partir das linhas (somar contagens, contar eventos), **multiplique cada linha pelo
seu `_sample_interval`** — ex.: `SUM(_sample_interval)` em vez de `COUNT(*)`,
`SUM(double1 * _sample_interval)` em vez de `SUM(double1)`. Ignorar isso subestima os números.

### R2 — cold path (retenção ILIMITADA)
Um **cron diário** consulta a SQL API pelos eventos do dia anterior (UTC) e grava **um**
NDJSON em `events/YYYY/MM/DD.ndjson`. R2 é grátis (10 GB, egress zero, free tier não expira)
e S3-compatible. Um arquivo/dia ⇒ ~365 escritas/ano, irrisório. O Analytics Engine é o
**staging** (query rápida, ~3 meses); o cron "congela" tudo em R2 pra sempre. Reaproveita o
cron que já existe — sem Queues (pago) nem Durable Object.

**Contagem em customMetadata.** Cada NDJSON leva `customMetadata: { events: '<n>' }` — a
contagem REAL de eventos do dia (`SUM(_sample_interval)` das linhas, não o nº de linhas; ver
sampling acima). Serve pro dashboard montar a série histórica de eventos além da janela do AE
**sem ler arquivo nenhum**: o `list()` do R2 já devolve o customMetadata de cada objeto.
Arquivo de antes dessa contagem existir é migrado pelo próprio cron: no loop do backfill, dia
com arquivo mas **sem** a metadata tem o corpo lido do R2, contado e re-gravado com a metadata
(nunca re-consulta o AE — se o dia já saiu da retenção, o re-export gravaria um marcador vazio
por cima do arquivo bom). Conta no teto de exports/run.

**Backfill (dias faltantes).** O export não cobre só "ontem": `exportRecentDays` varre de
`today-1` até `today-lookbackDays` (90 por padrão, dentro da janela de ~3 meses do AE), e para
cada dia **sem** arquivo no R2 (`HEAD` na chave) dispara o export. Idempotente — re-`put` na
mesma chave é seguro. Um dia **sem eventos** grava um arquivo NDJSON **vazio** (0 bytes) como
marcador, pra não ser re-consultado em toda execução (senão um dia ocioso gastaria o teto de
exports/run pra sempre). Assim, se um cron falhou ou o Worker ficou indisponível, o dia perdido é
re-exportado numa execução seguinte, **desde que ainda esteja dentro da janela de retenção do
AE** (depois disso o dado já saiu do staging e é irrecuperável). Há um teto de
`MAX_EXPORTS_PER_RUN` (10) exports por execução pra não estourar tempo/CPU do cron — dias
restantes pegam na próxima rodada.

**Limite de linhas da SQL API (caveat).** A SQL API do Analytics Engine corta o resultado
silenciosamente (~10k linhas). O export fixa `LIMIT 10000` explícito justamente pra **detectar**
o corte: se `rows.length >= ROW_LIMIT`, provavelmente truncou e eventos daquele dia foram
perdidos no arquivo — emite `console.warn` nos Workers Logs. Hoje o volume está muito abaixo
disso; se um dia chegar perto, paginar por janela de tempo (ex.: por hora) dentro do mesmo dia.

## Esquema e convenção de eventos

Função única `logEvent(ae, type, dims)` que escreve no Analytics Engine (e, via cold path, é
arquivada no R2 sem mudança no call site). Layout posicional do data point:

- `index` = `event_type` (chave de sampling)
- `blob1` = `event_type` (repetido, pra aparecer no SELECT sem decodificar o index)
- `blob2..N` = dimensões string (group_id, round, user_hash, status, ...)
- `double1..N` = medidas numéricas (duration_ms, matches_checked, count, ...)

**Convenções de nome:** `event_type` em snake_case, verbo no passado
(`prediction_saved`, `login_failure`). Todo tipo novo entra no union `EventType`.

**Eventos atuais:**

- Saúde: `poller_run` (ok/error + matches_checked, fixtures_updated, api_calls, duration_ms),
  `fixture_discovery_run` (ok/error + competitions, fixtures_updated, api_calls, duration_ms),
  `football_api_error` (erro de sync de qualquer provedor, football-data ou ESPN),
  `match_results_fallback` (fallback de resultados pela ESPN, ADR-016),
  `provider_http_attempt` (uma tentativa HTTP a um provedor de partidas),
  `radar_sync_run` (ok/partial/error/misconfig + competitions, mapped, pageview_rows, duration_ms)
  e `radar_sync_error` — emitidos só quando a coleta do radar roda com um Analytics
  Engine ligado; no GitHub Actions (caso normal, ver ADR-014) o binding não existe,
  `logEvent` vira no-op e o registro fica no log do workflow.
- Negócio: `prediction_saved` (single/bulk/import), `group_created`, `group_joined`,
  `group_renamed`, `group_invite_rotated`, `group_deleted`, `member_removed`, `login_success`, `login_failure`,
  `logout_all`, `oauth_error`, `matches_cache` (hit/miss).

### Esquema posicional por evento

`blob1` é **sempre** o `event_type` (preenchido pela `logEvent`); as dimensões passadas em
`dims.blobs` começam em `blob2`. As medidas em `dims.doubles` começam em `double1`. Esta tabela
é a **única fonte de verdade** do significado de cada posição — o NDJSON arquivado só faz
sentido com ela. Ao adicionar/alterar um evento, atualize aqui.

| event_type | blob2 | blob3 | blob4 | doubles |
|---|---|---|---|---|
| `poller_run` | `status` (`ok`/`error`) | — | — | `double1`=matches_checked, `double2`=fixtures_updated, `double3`=api_calls, `double4`=duration_ms |
| `fixture_discovery_run` | `status` (`ok`/`error`) | — | — | `double1`=competitions, `double2`=fixtures_updated, `double3`=api_calls, `double4`=duration_ms |
| `radar_sync_run` | `status` (`ok`/`partial`/`error`) | — | — | `double1`=competitions, `double2`=mapped (com artigo da Wikipédia), `double3`=pageview_rows, `double4`=duration_ms |
| `radar_sync_error` | `source` (`espn`/`wikipedia`) | `article` em `wikipedia`; `error_message` em `espn` | `error_message` (só em `wikipedia`) | — |
| `football_api_error` | `context` (`sync_endpoint`/`fixture_discovery`) **ou** `comp_id` (no poller) | `round` (poller) **ou** `comp_id` (fixture_discovery) | `error_message` | — |
| `match_results_fallback` | `competition_id` (vazio quando o fallback inteiro falhou no poller) | vazio em execução normal; `error_message` em falha | — | execução normal: `double1`=atualizados, `double2`=pulados; falha: sem doubles |
| `provider_http_attempt` | `provider` (`espn`/`football-data`) | `competition_id` (UUID; vazio se a chamada não tem competição) | `status` (HTTP; `0` = sem resposta: rede, timeout ou abort) | `context` (`poller`/`discovery`/`fallback`/`sync`) em blob5; `double1`=duration_ms, `double2`=peso (1 em falha, 10 em sucesso amostrado) |
| `prediction_saved` | `group_id` | `round` (vazio em bulk/import — múltiplas rodadas) | `user_hash` | `kind` (`single`/`bulk`/`import`) em blob5; `double1`=count (nº de palpites salvos) |
| `group_created` | `group_id` | `competition_id` | `user_hash` | `predictions_visibility` (`hidden`/`public`) em blob5; `double1`=points_exact, `double2`=points_winner, `double3`=points_penalty |
| `group_joined` | `group_id` | `user_hash` | — | — |
| `group_renamed` | `group_id` | `user_hash` | — | — |
| `group_invite_rotated` | `group_id` | `user_hash` | — | — |
| `group_deleted` | `group_id` | `user_hash` | — | — |
| `member_removed` | `group_id` | `user_hash` (do removido) | `reason` (`self`=saiu sozinho / `admin`=removido pelo dono) | — |
| `login_success` | `user_hash` | — | — | — |
| `logout_all` | `user_hash` | — | — | — |
| `login_failure` | `reason` (`session_expired`/`state_mismatch`/`exchange_failed`) | `error_message` (só em `exchange_failed`) | — | — |
| `oauth_error` | `error_code` | — | — | — |
| `matches_cache` | `result` (`hit`/`miss`) | `competition_id` | — | — |
| `security_storage_error` | `source` (`request_limits`/`logout`/`logout_all`/`cleanup`) | `category` (`read`/`write`/`oauth`) em `request_limits`; `error_message` nos demais | `error_message` (só em `request_limits`) | — |
| `request_perf` | `route` (`GET /matches`, ...) | `status` (HTTP, string) | — | `double1`=total_ms, `double2`=db_ms (0 se ausente), `double3`=rows (0 se ausente) |
| `email_reminder_sent` | `user_hash` | `competition_name` | `round` | — |
| `cron_round_reminder` | — | — | — | `double1`=rounds, `double2`=sent, `double3`=failed |
| `cron_round_reminder_misconfig` | `reason` (`no_api_key`) | — | — | — |
| `email_unsubscribed` | `user_hash` | `source` (`link`=via e-mail / `settings`=no app) | — | — |
| `email_resubscribed` | `user_hash` | `source` (`settings`) | — | — |

Nos eventos `poller_run` e `fixture_discovery_run`, `api_calls` conta requests
primárias planejadas. Cada data ESPN corresponde a uma request, após deduplicação
por competição e data. Cada rodada football-data do poller corresponde a uma
request, e a descoberta football-data consulta o calendário inteiro em uma request.
O log `[perf]` desses crons também registra `espn_max_concurrent` e
`espn_min_interval_ms` (teto de syncs ESPN em voo e pacing HTTP anti-403).
A fila de pacing HTTP ESPN vive no estado do isolate e serializa as chamadas
`fetchEspnScoreboard` desse isolate; cada tentativa HTTP (incluindo o único
retry em 429/5xx) respeita `espn_min_interval_ms` entre inícios. Invokes e
isolates distintos mantêm filas próprias e podem sobrepor requests. Os crons `0 6 * * *` (fixture discovery) e
`0,30 * * * *` (poller) coincidem às 06:00 UTC; o pilot remoto deve medir
sobreposição, 403, `total_ms` e `api_requests_planned` antes do gate 2027.
Retries dos provedores e chamadas do fallback ficam fora desse contador, que
continua contando o plano quando uma request falha. Ele não mede HTTP efetivamente
concluído. Os logs `[perf]` expõem `sync_tasks` e `api_requests_planned` para comparar
sincronizações lógicas com requests planejadas. A descoberta também registra
`espn_dates`, os nove dias de ontem UTC até hoje UTC + 7. O plano ESPN da
descoberta é N competições ESPN primárias × 9 datas antes de retries
(ex.: 90 com 10). O cron usa `scheduledTime` como referência
para a janela de resgate e as datas de descoberta. `duration_ms` mede tempo real.
O campo legado `matches_checked` do poller conta grupos de competição, rodada e dia
UTC selecionados, não partidas individuais.


Observação sobre `football_api_error`: tem **três formas** de chamada. No poller
(`matches/poller.ts`) é `[comp_id, round, error_message]`; nos endpoints de matches
(`POST /matches/sync` em `matches/router.ts`) é `[context, error_message]`; na descoberta de jogos
(`matches/fixtureDiscovery.ts`) é `[context='fixture_discovery', comp_id, error_message]`.
Distinga pelo blob2: `sync_endpoint` ⇒ forma de endpoint;
`fixture_discovery` ⇒ forma de descoberta (comp_id em blob3); senão ⇒ poller.

Observação sobre `match_results_fallback`: a execução normal tem `blobs: [competition_id]`
e doubles `[atualizados, pulados]`; a falha de uma competição vem de `logError`, com
`[competition_id, error_message]` e sem doubles. A falha do fallback inteiro, no poller, antes
chegava com a mensagem em blob2; agora blob2 fica vazio e a mensagem vai para blob3, o mesmo
formato das outras falhas. Linhas antigas com a mensagem em blob2 aparecem no painel como
execução sem liga e não entram no recorte por competição.

### Tentativas HTTP aos provedores (`provider_http_attempt`)

Cada `fetch` ao football-data.org ou à ESPN gera no máximo um evento, inclusive o segundo
`fetch` do retry de 429/5xx. A medição fica nos clientes (`providers/espn.ts` e
`fetchMatchesFromApi` em `matches/sync.ts`) e não adiciona nenhuma chamada externa. O processo
que chamou e a competição vêm do chamador, por um observer criado em
`observability/providerHttp.ts`.

- **Diferença para `api_calls`:** `api_calls` conta o plano (requests primárias planejadas).
  O evento conta o que foi de fato tentado, com retries e chamadas do fallback.
- **Contexto:** `poller`, `discovery` (descoberta de jogos), `fallback` (resultados pela ESPN) e
  `sync` (`POST /matches/sync`, manual). O radar roda no GitHub Actions sem Analytics Engine e
  não gera esse evento.
- **Competição:** UUID de `competitions.id` quando o chamador conhece a competição. O sync manual
  recebe o código do provedor, não o id, e grava vazio ("sem liga" no painel).
- **Falhas:** toda falha vira evento: 4xx, 5xx e a tentativa sem resposta (`status` `0`).
  O erro continua sendo lançado como antes; o observer nunca muda o resultado do `fetch`.
- **Sucessos:** só ~10% (`HTTP_SUCCESS_SAMPLE_RATE`) dos 2xx/3xx viram evento. Cada evento
  carrega o próprio peso em `double2`: 1 para falha, `1 / taxa` (10) para sucesso amostrado.
  Assim o painel estima o total sem fixar a taxa, e mudar a taxa no futuro não corrompe o
  histórico.
- **Agregação:** tentativas = `SUM(_sample_interval * double2)`; eventos gravados =
  `SUM(_sample_interval)`; duração média ponderada = `SUM(double1 * _sample_interval * double2)
  / SUM(_sample_interval * double2)`. Falha é contagem (sujeita só ao sampling do Analytics
  Engine); sucesso é estimativa.
- **Privacidade:** só provedor, status, contexto, duração e UUID de competição. Nunca URL, query,
  slug do provedor, chave de API, corpo nem mensagem de erro.

Ausência de linha não é zero: o evento só existe a partir do deploy, e uma competição sem
tentativa no período não aparece. O painel mostra "indisponível" quando a API não envia o
recorte, "sem registro ainda" quando nunca houve evento, e a data de início da coleta quando ela
é mais nova que o período.

Observação sobre `prediction_saved`: o `kind` (single/bulk/import) cai em **blob5** porque o
`round` (blob3) é mantido na posição mesmo vazio, pra alinhar as três variantes na mesma coluna.

### Regra de instrumentação (obrigatória)

**Ao criar ou modificar um endpoint que executa uma mutação de negócio** (cria/edita/remove
estado: palpite, grupo, membro, login...), adicione um `logEvent()` correspondente, depois da
escrita bem-sucedida. É o equivalente server-side do `trackEvent()` do cliente.

```ts
import { hashUserId, logEvent } from '../observability'

logEvent(c.env.AE, '<event_type>', {
  blobs: [group_id, await hashUserId(userId)], // dimensões string (posicional)
  doubles: [count],                            // medidas numéricas
})
```

**Rastrear vs. ignorar** — só vira evento se for **(a)** mudança de estado intencional **E
(b)** algo que você consultaria pra decidir. Lema: "poucos eventos, todos acionáveis".

- ✅ Rastrear: palpite salvo, grupo criado/entrou/renomeado, membro removido, login, falha de
  OAuth, saúde do cron/API externa.
- ❌ Ignorar: leituras (`GET`) — ler não é fato de negócio.
- ❌ Ignorar: navegação/cliques — isso é o GA no cliente (`trackEvent`); não duplicar.
- ❌ Ignorar: ações mecânicas de alto volume sem valor analítico.

## Dashboard de métricas

**Escolhido: o dashboard nativo** — página `/admin/metricas` no web app consome
`GET /metrics/overview` e `GET /metrics/archive` da API
(`api/src/observability/metricsRouter.ts`). A API é proxy da SQL API do Analytics
Engine — o token de conta (`AE_SQL_TOKEN`) fica em secret do Worker, nunca no
cliente. Acesso restrito ao e-mail em `ADMIN_EMAIL` (secret; sem ele, `/metrics`
responde 403 pra todo mundo — fechado por padrão). Gráficos em SVG puro (sem lib
de chart no bundle). Também audita o cold path: lista os NDJSON no R2 (dia
faltando = export falhou).

O que o dashboard mostra: KPIs (usuários palpitando, palpites — via
`SUM(double1 * _sample_interval)` —, grupos criados, entradas por grupo criado,
logins, cache hit rate), eventos/dia empilhado por tipo, saúde do poller +
chamadas/dia à API Football (quota), concentração de palpites (fatia do top
1/top 5 palpiteiros — só distribuição, nunca o hash), falhas de login por
motivo, e últimos erros. Os gráficos têm eixo X com datas (dd/mm, rótulos
esparsos; dia mais recente sempre rotulado) e os `event_type` aparecem
traduzidos pra linguagem de negócio (`EVENT_LABELS` em
`web/src/pages/AdminMetricsPage/labels.ts` — o nome cru fica no tooltip, já que
é a chave do esquema posicional acima). Há ainda um vigia de sampling: se
`AVG(_sample_interval)` do período passar de 1, um aviso alerta que os números
viraram estimativa.

Do D1 (`GET /metrics/business`, estado real, sem sampling) vêm os KPIs de
produto e o snapshot de **grupos por campeonato**: uma linha por temporada
cadastrada em `competitions`, inclusive as sem grupo, com id, nome, slug,
temporada, provider, visibilidade (`public`/`pilot`) e status. Contagens por
linha: grupos não excluídos, membros (usuários distintos nesses grupos) e grupos
ativos (com palpite salvo ou editado, por `predictions.updated_at`, nos últimos
14 dias, relógio UTC do D1). Grupos soft-deleted (`deleted_at`) não entram em
nenhuma contagem, inclusive "usuários em algum grupo" e "usuários que já
palpitaram". A página filtra a lista por visibilidade e status no cliente. O
payload só leva agregados: nada de e-mail, id de usuário, nome de grupo ou
código de convite. `topCompetitions` (top 10 com grupo) continua na resposta
para o front anterior.

A mesma linha traz a **saúde de resultados** da temporada, também só contagens
de jogos: `overdue_no_score` (jogos `scheduled`/`live`, não adiados, com
`home_score` ou `away_score` nulo e `start_time` há 3 horas ou mais) sinaliza
buraco de feed; `finished_unscored` (jogos `finished` com `scored_at` nulo)
sinaliza backlog de pontuação, e inclui `finished` sem placar, que o scoring não
alcança. `start_time` é comparado via `datetime()`, então `Z`, milissegundos e
offset não mudam o resultado. Temporada sem jogo ou sem pendência vem com
zero. O front antigo ignora os campos novos; o novo mostra "indisponível" (ou
"—") se a API ainda não os enviar, em vez de tratar a falta como zero.

Do Analytics Engine, `GET /metrics/ops?days=` alimenta a seção **Provedores de partidas ·
falhas e carga**, separada do `/metrics/overview` para que uma falha nela não derrube a página
e para que um front novo conviva com uma API ainda sem o endpoint. Traz:

- tentativas HTTP por provedor, processo e status (`httpByProvider`) e por competição e provedor
  (`httpByCompetition`), com tentativas estimadas, eventos gravados e duração;
- `httpFirstSeenAt`, o primeiro evento HTTP no Analytics Engine, sem filtro de período;
- erros de sync por origem (`poller`, `fixture_discovery`, `sync_endpoint`) e competição
  (`apiErrors`), lidos de `football_api_error` pela forma posicional descrita acima;
- execuções, jogos atualizados e falhas do fallback por competição (`fallback`).

A página resolve o id da competição para nome e temporada com o snapshot de
`/metrics/business`. Competição desconhecida aparece como "Campeonato" mais os 8 primeiros
caracteres do id; evento sem competição aparece como "sem liga". Mensagens livres do provedor
nunca saem no payload: valores de competição que não são UUID viram "sem liga". Falhas HTTP
acendem um alerta de aviso no topo da página. `football_api_error` aparece nos rótulos como
"Erro de sync de provedor", porque o poller, a descoberta e o sync manual cobrem os dois
provedores.

Do cold path o dashboard mostra: KPIs do acervo (dias arquivados, eventos
arquivados via customMetadata, tamanho total, dia mais antigo), **eventos/mês
do histórico completo** — a única visão que enxerga além da janela de ~3 meses
do AE (`/metrics/archive` lista `events/` inteiro paginando por cursor) — e a
integridade dos últimos 14 dias (contagem + tamanho por dia; dia sem arquivo
marcado como **faltando**). Backlog de ideias:
[`docs/dashboard-native.md`](dashboard-native.md).

Alternativa avaliada e **não adotada**: Grafana Cloud (Infinity → SQL API).
Guia mantido em [`docs/dashboard-grafana.md`](dashboard-grafana.md) caso um dia
precisemos de alertas (o único diferencial real). Contras: não enxerga R2 e
exige token de conta guardado num serviço externo.

Os endpoints `/metrics` são leitura — **sem** `logEvent` (regra de instrumentação).

## LGPD / privacidade

Log server-side de dado operacional legítimo não exige banner de consentimento (diferente do
GA, que é marketing/cliente). **Nunca** jogar PII crua — nem o `user_id` cru — no Analytics
Engine/R2: pseudonimizar com `hashUserId()` (SHA-256 truncado). Eventos servem pra
contar/agregar, não pra reidentificar.

`hashUserId()` é **sem salt** de propósito, e tudo bem: a entrada é um `user_id` que é um **UUID
v4 aleatório** (espaço de busca grande demais pra rainbow table / brute-force). Se um dia a
entrada do hash virar **e-mail ou id sequencial/de baixa entropia**, isso deixa de valer —
nesse caso seria obrigatório adicionar um salt (segredo) antes do hash, ou o pseudônimo seria
reversível por dicionário.

## Onde está o código

- `api/src/observability/events.ts` — `logEvent`, `EventType`, `hashUserId`.
- `api/src/observability/export.ts` — `exportEventsToR2` / `dayBounds` (cold path).
- `api/src/observability/metricsRouter.ts` — endpoints `/metrics/*` do dashboard admin.
- `api/src/observability/providerHttp.ts` — observer das tentativas HTTP (amostra, peso, contexto).
- `web/src/pages/AdminMetricsPage/` — página `/admin/metricas` (sem link de navegação).
- `api/src/observability/index.ts` — barrel (re-exporta `events` + `logRequestPerf`).
- `api/wrangler.toml` — `[observability]`, binding `AE` (dataset `palpitae_events`), binding
  R2 `EVENTS`, e os dois crons (poller a cada 30 min + export diário `5 0 * * *`).
- Instrumentação nos routers: `matches/poller.ts`, `predictions/router.ts`,
  `groups/router.ts`, `auth/router.ts`, `matches/router.ts`.
- `Env.AE`/`EVENTS`/credenciais da SQL API são **opcionais** → `logEvent`/export viram no-op
  em dev local e testes.

## Decisões descartadas — NÃO re-propor

- **Serviço externo de logs** (Datadog, Logtail): paga; a pilha nativa Cloudflare cobre grátis.
- **AWS S3 pro arquivo**: cobra egress e não tem free permanente. R2 é S3-compatible, egress
  zero, 10 GB free que não expira.
- **Queues pro buffer de eventos**: exigem plano Workers pago. Cron diário + Analytics Engine
  como staging resolve sem custo.
- **D1 como store de logs**: competiria com o domínio pelos write limits do D1.
