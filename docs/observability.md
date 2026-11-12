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

**Manifesto em customMetadata.** Cada NDJSON leva `customMetadata: { events, rows, complete }`.
`events` é a contagem REAL de eventos do dia (`SUM(_sample_interval)` das linhas, não o nº de
linhas; ver sampling acima) e serve pro dashboard montar a série histórica além da janela do AE
**sem ler arquivo nenhum**: o `list()` do R2 já devolve o customMetadata de cada objeto. `rows` é
o nº de linhas do arquivo. `complete: '1'` diz que o dia foi lido inteiro **e** consultado ao
menos 24 h depois de terminar; `'0'` é arquivo provisório ou truncado. Arquivo sem `complete`
é de antes do manifesto.

**Backfill e reparo.** O export não cobre só "ontem": `exportRecentDays` varre de `today-1` até
`today-lookbackDays` (90 por padrão, dentro da janela de ~3 meses do AE) e lê o manifesto de
cada dia (`HEAD` na chave):

- dia **sem** arquivo: exporta;
- arquivo com `complete: '1'`: não consulta mais;
- qualquer outro (provisório, truncado ou de antes do manifesto): reconsulta o AE e troca o
  arquivo só se a coleta nova não perde linhas (mais linhas, ou completa com ao menos as mesmas).
  Se a coleta nova, já completa, tem menos linhas (o dia saiu da retenção ou a SQL API devolve
  menos), o corpo arquivado fica e ganha o manifesto contado do próprio NDJSON, com
  `complete: '1'`.

O export das 00:05 é, portanto, provisório: o cron do dia seguinte reconsulta o dia e fecha o
arquivo, pegando linhas que a SQL API ainda não devolvia (em novembro de 2026, um dia arquivado
tinha uma linha a menos que o AE). Toda troca é condicionada ao etag lido no `HEAD`: se o
objeto mudou no meio do caminho, o R2 recusa e o arquivo atual fica. Falha na consulta ou no
upload não toca no objeto, e o dia volta na execução seguinte.

**Dia vazio x coleta falha.** Um dia **sem eventos** grava um NDJSON **vazio** (0 bytes) com
`rows: '0'`; com `complete: '1'` ele não é re-consultado (senão um dia ocioso gastaria o teto de
exports/run pra sempre). Coleta que falha não grava nada: resposta HTTP de erro ou resposta sem a
lista `data` lançam antes do `put`. Marcador vazio de antes do manifesto é reconsultado uma vez.
Um dia perdido é recuperável **enquanto estiver dentro da janela de retenção do AE** (depois
disso o dado já saiu do staging). Há um teto de `MAX_EXPORTS_PER_RUN` (10) exports e reparos por
execução pra não estourar tempo/CPU do cron — dias restantes pegam na próxima rodada.

**Limite de linhas da SQL API.** A SQL API do Analytics Engine corta o resultado silenciosamente
(~10k linhas). O export lê o dia em páginas de `LIMIT 10000` ordenadas por `timestamp`: página
cheia descarta as linhas do último segundo e a próxima começa nesse segundo, então nenhum
segundo fica dividido entre páginas. Um único segundo com mais de 10 mil linhas, ou mais de 10
páginas (100 mil linhas) no dia, grava o que foi lido com `complete: '0'` e um `console.warn`.
Hoje o maior dia dos últimos 90 tem cerca de 250 linhas.

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

- Saúde: `poller_run` (ok/error + matches_checked, fixtures_updated, api_calls, duration_ms,
  events_discarded),
  `fixture_discovery_run` (ok/error + competitions, fixtures_updated, api_calls, duration_ms,
  events_discarded, matches_missing),
  `football_api_error` (erro de sync de qualquer provedor, football-data ou ESPN),
  `competition_status_error` (descoberta não gravou o status da competição),
  `match_results_fallback` (fallback de resultados pela ESPN, ADR-016),
  `provider_http_attempt` (uma tentativa HTTP a um provedor de partidas),
  `match_teams_changed` (o provedor trocou os times de um jogo já gravado),
  `competition_unconfigured` (o sync da football-data recebeu uma competição nova sem configuração
  em `FOOTBALL_DATA_COMPETITIONS` e não a criou),
  `sync_event_discarded` (o sync não importou eventos do provedor; um registro por motivo e
  detalhe em cada sync, com a quantidade),
  `match_missing_from_feed` (jogo pendente que o calendário completo da football-data deixou de
  trazer na descoberta; a linha e os palpites ficam no banco),
  `scheduled_unknown_cron` (o `wrangler.toml` disparou um cron sem ramo no handler `scheduled`),
  `scheduled_config_missing` (configuração opcional ausente numa execução agendada),
  `radar_sync_run` (ok/partial/error/misconfig + competitions, mapped, pageview_rows, duration_ms)
  e `radar_sync_error` — emitidos só quando a coleta do radar roda com um Analytics
  Engine ligado; no GitHub Actions (caso normal, ver ADR-014) o binding não existe,
  `logEvent` vira no-op e o registro fica no log do workflow.
- Negócio: `prediction_saved` (single/bulk/import/replicate), `group_created`, `group_joined`,
  `invite_opened`, `group_renamed`, `group_invite_rotated`, `group_deleted`, `member_removed`, `login_success`, `login_failure`,
  `logout_all`, `oauth_error`, `matches_cache` (hit/miss), `account_created` (conta nova, com a
  origem do cadastro).

### Esquema posicional por evento

`blob1` é **sempre** o `event_type` (preenchido pela `logEvent`); as dimensões passadas em
`dims.blobs` começam em `blob2`. As medidas em `dims.doubles` começam em `double1`. Esta tabela
é a **única fonte de verdade** do significado de cada posição — o NDJSON arquivado só faz
sentido com ela. Ao adicionar/alterar um evento, atualize aqui.

| event_type | blob2 | blob3 | blob4 | doubles |
|---|---|---|---|---|
| `poller_run` | `status` (`ok`/`error`; `error` também quando a pontuação falha) | — | — | `double1`=matches_checked, `double2`=fixtures_updated, `double3`=api_calls, `double4`=duration_ms, `double5`=events_discarded (eventos que o sync não importou; ausente antes do registro de descartes). Descarte não muda o `status` |
| `fixture_discovery_run` | `status` (`ok`/`error`) | — | — | `double1`=competitions, `double2`=fixtures_updated, `double3`=api_calls, `double4`=duration_ms, `double5`=events_discarded, `double6`=matches_missing (jogos pendentes ausentes do calendário da football-data); os dois ausentes antes do registro de descartes. Descarte e ausência não mudam o `status` |
| `radar_sync_run` | `status` (`ok`/`partial`/`error`; `partial` quando algum slug da ESPN ou artigo da Wikipédia falhou) | — | — | `double1`=competitions, `double2`=mapped (com artigo da Wikipédia), `double3`=pageview_rows, `double4`=duration_ms |
| `radar_sync_error` | `source` (`espn`/`wikipedia`) | `article` em `wikipedia`; `error_message` em `espn` | `error_message` (só em `wikipedia`) | — |
| `scheduled_unknown_cron` | `cron` (expressão recebida em `controller.cron`) | — | — | — |
| `scheduled_config_missing` | `name` (`AE`/`EVENTS`/`PROXY_SHARED_SECRET`/`BASE_URL`/`CF_ACCOUNT_ID`/`AE_SQL_TOKEN`); um evento por nome ausente em cada execução agendada. Sem `AE` só há a linha `[scheduled] Configuração ausente` no log | — | — | — |
| `football_api_error` | `context` (`sync_endpoint`/`fixture_discovery`) **ou** `comp_id` (no poller) | `round` (poller) **ou** `comp_id` (fixture_discovery) | `error_message` | — |
| `match_results_fallback` | `competition_id` (vazio quando o fallback inteiro falhou no poller) | vazio em execução normal; `error_message` em falha | — | execução normal: `double1`=atualizados, `double2`=pulados; falha: sem doubles |
| `provider_http_attempt` | `provider` (`espn`/`football-data`) | `competition_id` (UUID; vazio se a chamada não tem competição) | `status` (HTTP; `0` = sem resposta: rede, timeout ou abort) | `context` (`poller`/`discovery`/`fallback`/`sync`) em blob5; `double1`=duration_ms, `double2`=peso (1 em falha ou cota zerada, 10 em sucesso amostrado); só football-data: `double3`=requests restantes na janela e `double4`=segundos até o reset, os dois `-1` sem cabeçalho válido |
| `match_teams_changed` | `provider` (`espn`/`football-data`) | `competition_id` (UUID) | `external_id` do jogo no provedor | `kind` em blob5: `swap` (mando invertido, os palpites do jogo foram invertidos junto) ou `replace` (um time mudou, os palpites ficaram como estavam); sem doubles |
| `sync_event_discarded` | `provider` (`espn`/`football-data`) | `competition_id` (UUID; vazio quando a competição ainda não existe no banco) | `reason`: `unknown_stage` (fase fora do mapa da ESPN), `season_mismatch` (evento de outra edição), `missing_competitor` (time ausente ou indefinido), `invalid_event` (id, data ou confronto inválidos) | `detail` em blob5: slug da fase em `unknown_stage`, ano recebido em `season_mismatch`, `tbd` para time a definir, `same_team`/`id`/`date`/`competition` em `invalid_event`, vazio se não há; `competition_code` (id da competição no provedor) em blob6; `double1`=eventos descartados com esse motivo e detalhe no sync |
| `match_missing_from_feed` | `provider` (`football-data`) | `competition_id` (UUID) | `external_id` do jogo no provedor | `start_time` gravado em blob5; sem doubles. Só a descoberta registra, com dois tetos: no máximo 10 por competição e 30 por execução, somando as competições, para ficar longe do limite de `writeDataPoint` por invocação. O total real, sem teto, vai em `fixture_discovery_run.double6` |
| `competition_status_error` | `competition_id` (UUID) | `error_message` | — | Sem doubles. A descoberta não gravou o status da competição depois de um sync bem-sucedido (falha do D1). O status fica como estava e a execução sai como `error` em `fixture_discovery_run` |
| `competition_unconfigured` | `provider` (`football-data`) | `code` da competição no provedor (ex.: `CLI`) | `external_id` da competição no provedor | `season` em blob5; sem doubles |
| `prediction_saved` | `group_id` | `round` (vazio em bulk/import/replicate — múltiplas rodadas) | `user_hash` | `kind` (`single`/`bulk`/`import`/`replicate`) em blob5; `competition_id` (UUID) em blob6, ausente em eventos anteriores ao deploy do enriquecimento; `double1`=count (nº de palpites salvos) |
| `group_created` | `group_id` | `competition_id` | `user_hash` | `predictions_visibility` (`hidden`/`public`) em blob5; `double1`=points_exact, `double2`=points_winner, `double3`=points_penalty |
| `group_joined` | `group_id` | `user_hash` | `method` (`convite_link`/`convite_antigo`/`codigo`; vazio se o cliente não informou) | `recent_signup` em blob5 (`1` = conta criada há menos de 1 h, `0` = mais antiga, vazio se não foi possível ler); os dois campos estão ausentes em eventos anteriores ao deploy da medição |
| `invite_opened` | — | — | — | — (só o tipo; ver "Funil de convite") |
| `group_renamed` | `group_id` | `user_hash` | — | — |
| `group_invite_rotated` | `group_id` | `user_hash` | — | — |
| `group_deleted` | `group_id` | `user_hash` | `competition_id` (UUID; ausente em eventos anteriores ao deploy do enriquecimento) | — |
| `member_removed` | `group_id` | `user_hash` (do removido) | `reason` (`self`=saiu sozinho / `admin`=removido pelo dono) | — |
| `login_success` | `user_hash` | — | — | — |
| `account_created` | `origin` (`convite`/`guia`/`busca`/`direto`/`desconhecida`) | `guide_slug` (só em `guia`, slug de guia publicado; vazio no índice dos guias e nas outras origens) | — | — (sem `user_hash`; ver "Origem do cadastro") |
| `logout_all` | `user_hash` | — | — | — |
| `login_failure` | `reason` (`session_expired`/`state_mismatch`/`exchange_failed`/`email_conflict`) | — | — | — |
| `oauth_error` | `error_code` | — | — | — |
| `matches_cache` | `result` (`hit`/`miss`) | `competition_id` | — | — |
| `security_storage_error` | `source` (`request_limits`/`logout`/`logout_all`/`cleanup`) | `category` (`read`/`write`/`oauth`) em `request_limits`; `error_message` nos demais | `error_message` (só em `request_limits`) | — |
| `request_perf` | `route` (`GET /matches`, ...) | `status` (HTTP, string) | — | `double1`=total_ms, `double2`=db_ms (0 se ausente), `double3`=rows (0 se ausente) |
| `email_reminder_sent` | `user_hash` | `reminder_date` (dia em Brasília; antes do lembrete diário era `competition_name`) | sem valor (antes era `round`) | `double1`=jogos listados no e-mail, `double2`=grupos listados |
| `email_reminder_failed` | `user_hash` | `reminder_date` | `reason` (`quota_exceeded`, `subrequest_budget`, `unsub_check_failed`, `http_<status>`, `unknown`) | `double1`=jogos que o e-mail listaria |
| `cron_round_reminder` | — | — | — | `double1`=rodadas com jogo listado, `double2`=sent, `double3`=failed, `double4`=jogos listados nos e-mails enviados |
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
isolates distintos mantêm filas próprias e podem sobrepor requests. A descoberta (`15 6 * * *`) roda às 06:15 UTC,
fora dos minutos 0 e 30 do poller (`0,30 * * * *`). As medições de sobreposição
feitas quando a descoberta rodava às 06:00 UTC ficam como registro histórico; o
pilot remoto deve medir 403, `total_ms` e `api_requests_planned` antes do gate 2027.
Retries dos provedores e chamadas do fallback ficam fora desse contador, que
continua contando o plano quando uma request falha. Ele não mede HTTP efetivamente
concluído. Os logs `[perf]` expõem `sync_tasks` e `api_requests_planned` para comparar
sincronizações lógicas com requests planejadas. A descoberta também registra
`espn_dates`, os nove dias de ontem UTC até hoje UTC + 7. O plano ESPN da
descoberta é N competições ESPN primárias × 9 datas antes de retries
(ex.: 90 com 10). O cron usa `scheduledTime` como referência
para a janela de resgate e as datas de descoberta. `duration_ms` mede tempo real.
O campo legado `matches_checked` do poller conta grupos de competição, rodada e dia
UTC selecionados, não partidas individuais. Na varredura de atrasados ele vale 1, e o
log `[perf]` traz `late_sweep_tasks = 1`.


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
`fetch` do retry. A ESPN retenta respostas 429 e 5xx; o football-data.org retenta 429 uma vez,
depois do reset que a resposta informou (ver "Cota da football-data" abaixo).
A medição fica nos clientes (`providers/espn.ts` e
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
- **Cota (football-data):** `double3` guarda as requests restantes e `double4` os segundos até
  o reset, lidos dos cabeçalhos da resposta (`-1` quando ausentes ou inválidos). Um 2xx com cota
  zerada sai sempre, com peso 1, fora da amostra dos sucessos. Eventos da ESPN e os anteriores
  ao deploy não têm essas posições.
- **Privacidade:** só provedor, status, contexto, duração, cota e UUID de competição. Nunca URL,
  query, slug do provedor, chave de API, corpo nem mensagem de erro.

#### Cota da football-data

O cliente (`fetchMatchesFromApi`) lê a cota de toda resposta: requests restantes em
`x-requests-available-minute` (também aceita `X-Requests-Available` e `X-RequestsAvailable`) e o
reset no maior valor entre `X-RequestCounter-Reset`, `x-request_counter-reset` e `Retry-After`.
Um 429, ou uma resposta com zero requests restantes, pausa as chamadas até o reset. Sem reset
válido a pausa é de 60 s; o 429 pausa no mínimo 6 s; nenhuma pausa passa de 1 h. Durante a
pausa, uma chamada espera até 65 s; se o reset estiver mais longe, falha sem request
(`FootballDataQuotaError`, registrada como `football_api_error`), e o próximo ciclo tenta de
novo: 30 min no poller (com o fallback da ESPN no mesmo tick), 24 h na descoberta. O retry do 429
passa pela mesma regra.

A pausa vale só para o isolate que viu a resposta. Outro isolate do Worker, o radar no GitHub
Actions e scripts locais não a enxergam, então ela não é um orçamento global: discovery e poller
em isolates diferentes ainda podem coincidir no mesmo minuto. A coordenação entre eles é do
backlog de resiliência dos provedores.

Ausência de linha não é zero: o evento só existe a partir do deploy, e uma competição sem
tentativa no período não aparece. O painel mostra "indisponível" quando a API não envia o
recorte, "sem registro ainda" quando nunca houve evento, e a data de início da coleta quando ela
é mais nova que o período.

Observação sobre `prediction_saved`: o `kind` (single/bulk/import/replicate) cai em **blob5** porque o
`round` (blob3) é mantido na posição mesmo vazio, pra alinhar as quatro variantes na mesma coluna. O `replicate` ("Aplicar também em") grava `double1` com o número de palpites escritos nos outros grupos.

### Dimensão `competition_id` em `prediction_saved` e `group_deleted`

Os dois eventos passaram a carregar o UUID da competição do grupo: `prediction_saved` em
**blob6** e `group_deleted` em **blob4**. A dimensão entra sempre **depois** das posições
existentes, então nenhuma coluna mudou de lugar e consultas e arquivos R2 antigos continuam
válidos.

- **Origem:** `competition_id` do jogo no palpite único, do jogo salvo no bulk, do grupo de destino
  no import e do grupo na exclusão. Vem de linhas que a rota já leu para validar a mutação, sem
  query extra, e só é gravado depois da escrita bem-sucedida.
- **Sem backfill:** evento anterior ao deploy chega com o blob vazio (o Analytics Engine devolve
  `''` para posição não gravada). O painel agrupa esse caso em "sem liga". O R2 já arquivado não é
  reescrito.
- **Compatibilidade de deploy:** API e web não sobem juntas. A web nova trata
  `/metrics/competition-activity` ausente ou com erro como "indisponível" sem derrubar a página, e a
  API nova convive com a web antiga, que não consome a rota.
- **Privacidade:** só o UUID da competição, que já era dimensão de `group_created`. Nada de nome de
  campeonato, grupo ou usuário.

### Funil de convite (`invite_opened` e `group_joined`)

Responde quem abriu um convite e quem entrou por ele, sem depender de cookies. O GA4 só vê quem
aceitou cookies e não enxerga a abertura.

**Abertura.** A Pages Function de `/convite/:code` decide se a requisição é uma abertura e, em
segundo plano (`waitUntil`), chama `POST /public/invite-opens`, que grava `invite_opened`. O
caminho passa pela API porque o binding do Analytics Engine existe só no Worker. A contagem não
fica em `GET /public/invites/:code`: essa rota tem cache no edge, atende crawlers e a SPA pode
chamá-la de novo, então não dá uma abertura por navegação.

Conta como abertura o `GET` de documento de uma pessoa, com código de formato válido. Ficam de
fora:

- crawlers de preview, pelo mesmo `isPreviewCrawler` que decide o `data-convite`;
- cliente que não se apresenta como navegador (User-Agent sem `Mozilla/` ou vazio);
- `HEAD`, subrecurso (`Sec-Fetch-Mode` diferente de `navigate`) e pré-busca do navegador
  (`Sec-Purpose`, `Purpose`, `X-Purpose`, `X-Moz`);
- código com formato inválido.

Recarregar a página é uma nova navegação e conta de novo. Código bem formado de grupo excluído ou
inexistente conta, porque a Function não espera a resposta da API para decidir. Links antigos com
`?convite=` não passam pela Function e não geram abertura. Uma pessoa cujo navegador se identifique
como crawler também fica de fora.

`POST /public/invite-opens` exige o `PROXY_SHARED_SECRET` e o header `X-Palpitae-Invite-Open`, que o
proxy público remove (ver `docs/security.md`), para que outra origem não infle o funil. Sem o segredo nos dois lados a abertura não é registrada e o painel mostra
"nenhum registro ainda".

**Entrada.** O front envia `entry_method` em `POST /groups/join`, e a API aceita só `convite_link`,
`convite_antigo` ou `codigo`. `convite_link` exige que o documento tenha vindo de `/convite/<código>`,
a rota que conta aberturas, e consome a marca dessa abertura. O caminho vem da entrada de navegação do
navegador, porque o `index.html` reescreve a URL antes do bundle para quem tem sessão conhecida. Quem
chegou por link antigo com `?convite=` grava `convite_antigo`. Valor ausente ou fora da lista grava o método vazio e não recusa a entrada. A flag de
cadastro recente é calculada no D1, em SQL, comparando `group_members.joined_at` com
`users.created_at`, depois de a linha do membro existir. A flag e a contagem do painel usam a mesma
expressão (`RECENT_SIGNUP_SQL`).

**Painel.** `GET /metrics/invite-funnel?days=` alimenta a seção **Funil de convite**, separada do
`/overview` para que uma falha nela não derrube a página. Aberturas e entradas vêm do Analytics
Engine com `SUM(_sample_interval)`. O campo `d1` conta as mesmas entradas no D1, na mesma janela,
para conferência. A taxa mostrada é `convite_link` dividido por aberturas, porque quem digita o
código ou usa link antigo não passa pela página de convite.

Por que evento e D1 podem divergir:

- o evento conta cada entrada, e o D1 só tem quem continua no grupo (quem saiu ou foi removido some);
- evento anterior ao deploy entra em "entradas" mas não em novos e existentes, e aparece em
  "entradas sem classificação". `joinDimensionSince` e `opensSince` dizem desde quando há coleta, e
  a página avisa enquanto ela for mais nova que o período;
- sob sampling do Analytics Engine as contagens de evento são estimativas.

**Privacidade.** `invite_opened` grava só o tipo do evento: nenhum código, nome de grupo, id, e-mail,
IP ou User-Agent. O pedido da Function não leva o código. O IP do visitante viaja em
`X-Palpitae-Client-IP` só para a quota por IP, como em toda chamada do proxy, e não entra no evento.

### Origem do cadastro (`account_created`)

Responde de onde veio cada conta nova, sem depender de cookies de consentimento. O D1 só tem a
data do cadastro, e `login_success` não separa conta nova de login. O evento fica no Analytics
Engine, como o funil de convite, e não em coluna de `users`, porque medição não é estado do
domínio ("D1 como store de logs" está em "Decisões descartadas").

**Categorias.** Lista fechada: `convite`, `guia`, `busca`, `direto` e `desconhecida`. O valor vem
do navegador, então é entrada não confiável: `parseSignupOrigin` aceita só `convite`, `busca`,
`direto` e os tokens de guia com slug que existe na lista `GUIDE_SLUGS`. Qualquer outro valor,
inclusive slug inexistente, ausência do valor e texto livre, vira `desconhecida`. Um teste de
contrato confere `GUIDE_SLUGS` contra os guias de `web/build/guides.ts`.

**Caminho do valor.** O botão "Entrar com Google" envia `origem` em `GET /auth/google` (regra do
navegador em [`analytics.md`](analytics.md)). A API grava o token, se reconhecido, no cookie
temporário `oauth_origin` (5 minutos, como os demais do OAuth) e o valida de novo no callback, porque
cookie também vem do cliente. O cookie é gravado mesmo vazio, para a tentativa atual não herdar a
origem de uma tentativa anterior.

**Exatamente um evento por conta.** `upsertUser` devolve `isNew`, verdadeiro só para quem inseriu a
linha. O evento sai logo depois da escrita no D1:

- login de conta existente não gera evento, qualquer que seja a origem enviada;
- callback repetido encontra a conta já criada, ou falha antes disso porque os cookies temporários
  foram apagados e o `code` do Google só vale uma vez;
- callbacks simultâneos da mesma conta nova disputam o `UNIQUE` de `users`: um `INSERT` vence e gera
  o evento, o outro entra como conta existente, e os dois logins terminam com sessão.

**Medição não bloqueia login.** `account_created` e `login_success` saem por `tryLogEvent`, que
registra a falha no console e deixa o fluxo seguir.

**Painel.** `GET /metrics/signup-origins?days=` alimenta a seção **Cadastros por origem**, separada
do `/overview` para que uma falha nela não derrube a página. Os eventos vêm com
`SUM(_sample_interval)`. O campo `d1.signups` conta as contas criadas no D1 na mesma janela, com
`datetime(created_at)` para normalizar o ISO gravado pelo login. A seção mostra a soma das origens e
o total do D1 lado a lado e, quando diferem, uma linha com a diferença. Ela não é encaixada em
nenhuma categoria, porque é o que mostra se a medição fecha.

Por que a soma pode ficar abaixo do D1:

- conta criada antes do deploy não tem evento. `originsSince` diz desde quando há coleta, e a página
  avisa enquanto ela for mais nova que o período;
- evento perdido numa falha do Analytics Engine, que só aparece no console;
- sob sampling do Analytics Engine as contagens de evento são estimativas.

**Privacidade.** O evento grava só a categoria e o slug validado. Não leva URL, referrer, nome,
e-mail, IP, User-Agent, `user_id` nem `user_hash`, então não há como ligar a origem a uma pessoa ou
acompanhar alguém entre sessões. O painel só devolve categorias e slugs da lista.

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
- ❌ Ignorar: leituras (`GET`) — ler não é fato de negócio. A exceção é a abertura de convite
  (`invite_opened`), porque sem ela o funil de convite não tem denominador.
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

### Alerta proporcional de falhas de login

A faixa de status no topo de `/admin/metricas` acende só com volume e proporção
elevados na janela do painel. A regra vive em
`web/src/pages/AdminMetricsPage/loginFailureAlert.ts` (7/30/90 dias; padrão 30).

Denominador = callbacks registrados com `login_success` ou `login_failure`
(agregados com `SUM(_sample_interval)`). Volume mínimo = 10 callbacks.
Proporção = falhas / callbacks ≥ 15%.

Pontos cegos fora do denominador: `oauth_error` (Google recusou antes do
callback com cookies), abandono (usuário não voltou) e ausência de callback.
A proporção mede só esses callbacks registrados. `oauth_error` e
`login_failure` continuam na lista Erros recentes para inspeção; o chip
genérico de erros recentes no topo ignora esses dois tipos (login tem alerta
próprio; oauth é etapa anterior).

A tabela Falhas de login por motivo lista cada `reason` mesmo com o alerta do
topo apagado. Conduta operacional: abrir a tabela por motivo, checar erros
recentes e reavaliar antes de tratar o chip como incidente.

#### Janela

A seleção 7/30/90d é média lenta. Rajadas curtas podem diluir-se na janela
longa. Em 7d o volume mínimo pode ficar abaixo do limiar. O canal desta fatia
é o próprio painel; alerta automático push fica fora do escopo aqui. O guia
opcional de Grafana está em
[`docs/dashboard-grafana.md`](dashboard-grafana.md).

#### Heurística 15% / 10

Os limiares são calibração operacional, com risco de falso alerta e de degraus
ao trocar a janela. Com os dados da calibração o painel já acende em 30d.

#### Sampling

Contagens usam `SUM(_sample_interval)` e podem ser fracionárias. O rótulo do
alerta arredonda; se a média de sampling for >1 ou a contagem for fracionária,
o rótulo marca estimativa (`≈`).

#### Ausência de `login_success` em `totals`

A SQL do overview agrupa por `event_type` e só devolve tipos presentes no
período. Zero sucessos com falhas listadas é zero legítimo nesse contrato. Esta
fatia não adiciona detecção de integridade para esse caso.

Calibração com leitura autorizada do Analytics Engine em 2026-11-02 (sessão
admin, sem PII; sampling médio ~1,05–1,10):

| Janela | sucessos | falhas | callbacks | proporção |
|---|---|---|---|---|
| 7d | 6 | 1 | 7 | 14% |
| 30d | 21 | 5 | 26 | 19% |
| 90d | 196 | 11 | 207 | 5% |

Semanas com volume ≥15 em ago/2026 ficaram em 0–8%. O limiar de 15% fica acima
desse patamar e perto de 3× o baseline de 90d; o mínimo de 10 evita alerta na
janela de 7d com uma única falha. Com os números do dia da calibração, 30d
acende e 7d/90d não.

#### `session_expired`

O motivo é gravado quando faltam os cookies temporários `oauth_state` /
`oauth_nonce` / `oauth_verifier` no callback (TTL de 5 minutos em
`auth/router.ts`). Em 90d, 10 das 11 falhas foram `session_expired` e 1 foi
`exchange_failed`. Causas compatíveis com o código, sem confirmação por evento:
fluxo OAuth demorou mais que 5 minutos, cookies de terceiros/bloqueio, contexto
de navegação diferente do início do login, limpeza de cookies no meio do fluxo.
O Analytics Engine não registra cookies, tokens, code verifier nem valores
OAuth; a telemetria não distingue qual causa ocorreu em cada linha. O motivo
sozinho não basta para concluir incidente de provedor.

#### `exchange_failed`

Gravado no `catch` do callback em `auth/router.ts` com
`blobs: ['exchange_failed']` (só o motivo em `blob2`). O código atual grava
apenas o motivo no Analytics Engine; o detalhe fica no `console.error` do
Worker. A falha observada na calibração foi resposta 520 na troca de código.

#### `email_conflict`

O e-mail da conta Google já está gravado em outra conta do Palpitaê. Acontece
com conta Google nova que recebe o e-mail de uma conta antiga, ou com conta
existente que troca para o e-mail de outra. O login termina sem sessão,
redireciona com `?auth_error=email_conflict` e não altera nenhuma das duas
contas: o app não junta contas pelo e-mail. Resolver exige olhar as duas linhas
de `users` e decidir à mão.

#### `state_mismatch`

Motivo distinto: o `state` do cookie temporário difere do `state` devolvido no
callback. Avaliar separadamente na tabela por motivo. A proporção agregada
deixa esse caso sem regra específica.

#### Segundo método de login

Estudo futuro (e-mail com link de uso único, passkey ou IdP adicional vinculado
à conta local). Fora desta fatia; ver `.scratch/research/fallbacks-servicos.md`.

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
- execuções, jogos atualizados e falhas do fallback por competição (`fallback`);
- eventos que o sync descartou por provedor, competição, motivo e detalhe (`discards`), lidos de
  `sync_event_discarded`: `events` soma `double1` ponderado pelo sampling e `syncs` conta as
  execuções que registraram o descarte. O mesmo evento do provedor é descartado de novo a cada
  execução (o poller roda a cada 30 minutos), então `events` acumula repetições; o painel mostra
  as duas contagens e a média por execução;
- jogos pendentes que a descoberta não viu no calendário da football-data (`missingMatches`),
  lidos de `match_missing_from_feed`, com quantas vezes e quando foram registrados por último.

`discards` e `missingMatches` só levam identificadores do provedor (slug da fase, código da
competição, id do jogo, horário ISO); qualquer outro texto chega vazio. Sem os dois campos (API
anterior), a página omite a subseção em vez de mostrar zero.

A página resolve o id da competição para nome e temporada com o snapshot de
`/metrics/business`. Competição desconhecida aparece como "Campeonato" mais os 8 primeiros
caracteres do id; evento sem competição aparece como "sem liga". Mensagens livres do provedor
nunca saem no payload: valores de competição que não são UUID viram "sem liga". Falhas HTTP
acendem um alerta de aviso no topo da página. `football_api_error` aparece nos rótulos como
"Erro de sync de provedor", porque o poller, a descoberta e o sync manual cobrem os dois
provedores.

Do Analytics Engine, `GET /metrics/competition-activity?days=` alimenta a seção **Atividade por
campeonato**, também separada do `/overview` pelo mesmo motivo. Agrega no período (7/30/90 dias):

- grupos criados por campeonato, de `group_created` (blob3), com `SUM(_sample_interval)`;
- palpites salvos e envios por campeonato, de `prediction_saved` (blob6), com
  `SUM(double1 * _sample_interval)` e `SUM(_sample_interval)`;
- `predictionsDimensionSince`, o primeiro `prediction_saved` com a dimensão, sem filtro de período;
- `groupsDaily`, as criações de grupo por dia UTC (`YYYY-MM-DD`) × campeonato, de `group_created`
  (blob3) com `SUM(_sample_interval)`, na mesma janela. Só vêm dias com criação; o cliente preenche os
  dias zerados e desenha barras empilhadas por campeonato (os 8 maiores do período, o resto em
  "Outros"). A consulta tem teto de 5000 linhas, do dia mais recente para o mais antigo; ao bater no
  teto a resposta traz `groupsDailyTruncated: true` e o painel avisa que os dias antigos podem estar
  incompletos. O primeiro dia da janela é parcial (a janela é `NOW() - N dias`, não meia-noite): o
  que cai fora dos N dias do eixo fica só na tabela, com aviso.

A SQL API não faz join com o D1: o Worker pega os UUIDs que voltaram do Analytics Engine e resolve
nome e temporada em `competitions` numa query só (`json_each`). Id que não existe mais no D1 sai com
nome e temporada nulos e a página mostra "Campeonato" mais os 8 primeiros caracteres. Valor que não
é UUID vira "sem liga", sem texto livre no payload. Como o evento histórico não tem a dimensão, os
palpites anteriores ao deploy aparecem na linha "sem liga", e a página avisa quando a dimensão é mais
nova que o período selecionado ou ainda não foi coletada: isso é falta de dado, não zero atividade.
Sob sampling do Analytics Engine as contagens são estimativas, inclusive as da série diária. A
série não leva nome de grupo, código de convite nem user_hash: só dia, UUID de campeonato validado e
contagem. Web nova com API anterior à série mostra a tabela e "série diária indisponível".

Do Analytics Engine e do D1, `GET /metrics/invite-funnel?days=` alimenta a seção **Funil de
convite**; o desenho está em "Funil de convite", acima.

Do Analytics Engine e do D1, `GET /metrics/signup-origins?days=` alimenta a seção **Cadastros por
origem**; o desenho está em "Origem do cadastro", acima.

Do Analytics Engine, `GET /metrics/heatmap?days=` alimenta a seção **Mapa de calor · palpites e
logins**, também separada do `/overview`. Agrega `prediction_saved` e `login_success` por hora UTC
(`toStartOfInterval(timestamp, INTERVAL '1' HOUR)`) no período (7/30/90 dias). Cada linha de `hourly`
traz `hour` (ISO UTC), `prediction_saves` (envios, `SUM(_sample_interval)`), `predictions` (palpites
salvos, `SUM(double1 * _sample_interval)`) e `logins` (`SUM(_sample_interval)`). Só vêm horas com
evento e o cliente preenche os zeros. A resposta também leva `firstSeenAt` por tipo, o primeiro
evento no Analytics Engine sem filtro de período, e `avgSampleInterval`, a média do
`_sample_interval` desses dois tipos na janela. O payload não tem `user_hash` nem identificador,
só hora e contagem.

O Worker não converte fuso. A página monta a grade 7×24 (domingo a sábado × 0h a 23h) e converte
UTC para BRT na exibição, com UTC−3 fixo, porque o Brasil não tem horário de verão desde 2019. A
conversão muda o dia e a semana: 02h UTC de segunda é 23h de domingo em BRT. O cabeçalho da coluna
é a hora inicial, então a coluna "11" cobre 11h a 12h. Um seletor alterna entre "Palpites salvos",
"Envios de palpites" (bulk e import contam como um envio) e "Logins", cada série com cor própria
(verde para palpites, azul para logins).

Limites de leitura. A célula soma todas as ocorrências daquele dia da semana e hora no período,
sem normalizar: com 30 ou 90 dias, alguns dias da semana ocorrem uma vez a mais e pesam mais. A
janela é `NOW() - N dias`, então a primeira e a última hora são parciais. A consulta tem teto de
5000 linhas, acima do máximo possível (cerca de 4370). Com `avgSampleInterval` acima de 1,01 a
página avisa que as contagens são estimativas e marca o total e as descrições das células com "≈".

Quando falta coleta, a página não desenha zero. Tipo sem nenhum evento (`firstSeenAt` nulo) mostra
o aviso e esconde a grade. Primeiro evento mais novo que o período mostra a data em BRT, com folga
de um dia por causa da retenção de 90 dias. Web nova com API anterior à rota mostra "indisponível",
e API nova com web antiga só tem uma rota sem uso.

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
- `api/src/observability/inviteFunnel.ts` — regras do funil de convite (método, cadastro recente, totais).
- `api/src/observability/signupOrigin.ts` — origem do cadastro (categorias, guias aceitos, totais, contagem do D1).
- `web/src/analytics/signupOrigin.ts` — chegada da aba e valor enviado ao iniciar o OAuth.
- `web/functions/convite/[code].ts` — decide o que é abertura de convite (`isInviteOpen`).
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
