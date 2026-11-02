# Capacidade e coordenação das chamadas aos provedores

Documento de arquitetura do ticket 01 da epic de resiliência de serviços. Registra inventário, medições disponíveis, comparação de alternativas e a **hipótese D1** escolhida pelo operador como candidata sujeita a critérios. **Não é ADR fechada:** a decisão definitiva depende das medições contínuas e das escolhas listadas na seção de critérios.

**Base de código:** `aa5f20a` (`origin/main` no momento da coleta).  
**Coleta:** 2026-11-02.  
**Pesquisa prévia (ponto de partida, não fato atual):** `.scratch/research/capacidade-coordenacao-provedores.md` (30/10/2026, base `9f0ad95`).

Rótulos: **[código]** lido neste SHA; **[doc]** documentação oficial lida nesta coleta; **[medida]** produção via acesso existente (D1 remoto RO, GraphQL D1, `GET /metrics/ops` autenticado); **[cálculo]** derivado de código + doc + medida com premissa explícita; **[hipótese]** não verificado; **[lacuna]** dado indisponível.

---

## 1. Conclusões sustentadas

1. A demanda aos provedores de partidas cresce com competições ativas e jogos na janela, não com usuários. [código + cálculo]
2. O gargalo observado hoje no football-data é a **rajada do discovery diário** (concorrência 4 sem orçamento compartilhado entre tentativas), não a média diária. Em produção há `429` recorrentes às 06:00 UTC no discovery. [medida]
3. O volume médio de tentativas HTTP instrumentadas é baixo frente a 10 req/min sustentados. A amostragem de sucessos (~10 %) e a ausência do radar no AE limitam a precisão do pico. [medida]
4. Queues no plano Free retêm mensagens **24 h fixas**, abaixo da recuperação exigida pela spec (>24 h). Estado durável de trabalho pendente não pode viver só em mensagens Free. [doc]
5. `UPDATE … RETURNING` já roda em produção no D1 (`api/src/security/limits.ts`). [código]
6. O uso atual do D1 de produto já oscila perto do teto Free de **leituras/dia** em alguns dias; as escritas/dia ficam bem abaixo do teto Free. Qualquer coordenação em D1 precisa caber nessa margem ou pressupor Workers Paid. [medida]
7. **Hipótese D1 (candidata, não decisão fechada):** razão de orçamento + fila de trabalho em tabelas D1, com camada única de acesso no Worker e drenador por cron. Durable Object com alarme permanece alternativa se houver contenção medida ou se o operador eliminar o drenador. [hipótese + critério]

---

## 2. Inventário de chamadores

Fonte: árvore em `aa5f20a`. Nomes de secrets apenas; valores não lidos.

### 2.1 football-data.org

Cliente: `fetchMatchesFromApi` em `api/src/matches/sync.ts`. Token `FOOTBALL_API_KEY`. Retry único após 6 s em HTTP 429 (`FD_RETRY_BACKOFF_MS`). Concorrência por execução: `FD_MAX_CONCURRENT_REQUESTS = 4`. Sem leitura dos cabeçalhos de cota na chamada.

| Chamador | Gatilho | Chamadas por execução (sem retry) |
|---|---|---|
| Poller (`pollActiveMatches`) | cron `0,30 * * * *` | 1 por (competição, rodada) com jogo na janela |
| Discovery (`discoverFixtures`) | cron `0 6 * * *` | 1 por competição FD com `status != finished` |
| `POST /matches/sync` | admin (`ADMIN_EMAIL`) | 1 |
| `api/scripts/test-results-api.ts` | manual local | ilimitado; fora da telemetria do Worker |

### 2.2 ESPN

Cliente: `fetchEspnScoreboard` em `api/src/providers/espn.ts`. Sem credencial. Mutex por isolate, `ESPN_MIN_INTERVAL_MS = 1300`, timeout 10 s, retry em 429/5xx. Concorrência de syncs: `ESPN_MAX_CONCURRENT_COMPETITIONS = 2`.

| Chamador | Gatilho | Chamadas por execução (sem retry) |
|---|---|---|
| Discovery ESPN-primária | `0 6 * * *` | 9 datas × E competições |
| Poller ESPN-primária | `0,30 * * * *` | até 3 datas por competição com pendência |
| Fallback (`scoreWindowFromEspn`) | após sync do poller em competições FD | até 3 datas por competição FD elegível |
| `POST /matches/sync` (código ESPN) | admin | 1 a 9 conforme `dates` |
| Radar (`radar-sync.yml` + `radarSync.ts`) | GitHub Actions `0 7 * * *` | 40 slugs (`ESPN_LEAGUES`) + Wikimedia pageviews |

O radar grava no D1 via `wrangler d1 execute --remote` e **não** emite `provider_http_attempt`.

### 2.3 Outros processos externos

Resend (lembretes), Google OAuth, Analytics Engine SQL API, scripts locais. Fora do escopo de coordenação de partidas neste documento (tickets 06/07).

### 2.4 Crons do Worker

Quatro triggers em `api/wrangler.toml`: poller `:00/:30`, export AE `5 0 * * *`, lembretes `0 10 * * *`, discovery `0 6 * * *`. Limite Free de Cron Triggers por conta: 5. [doc + código]

---

## 3. Medições de produção (2026-11-02)

Nenhuma chamada nova foi feita a football-data.org ou ESPN nesta coleta. Leituras: D1 remoto (SELECT), GraphQL `d1AnalyticsAdaptiveGroups`, painel admin `/admin/metricas` → `GET /metrics/ops` e `/metrics/overview` com sessão existente.

### 3.1 Inventário D1 remoto

Competições com `status != finished` (descoberta e poller):

| Provider | Quantidade | Observação |
|---|---|---|
| football-data | **11** (10 ongoing + 1 upcoming Copa do Mundo) | F efetivo |
| espn | **4** (3 pilot + 1 public) | E efetivo; iguais à pesquisa de 30/10 |

Banco `palpitae`: ~4,9 MB; 4040 jogos; `finished_unscored = 0`; `past_unscored = 3` no instante da coleta; a maior parte das linhas sem `scored_at` é jogo futuro (`future_scheduled ≈ 2272`).

### 3.2 Uso D1 (GraphQL, dias UTC)

| Dia | rowsRead | rowsWritten | writeQueries |
|---|---|---|---|
| 2026-10-26 | 1 210 761 | 15 120 | 6 228 |
| 2026-10-27 | 1 242 564 | 11 218 | 3 878 |
| 2026-10-28 | 2 369 906 | 10 964 | 3 767 |
| 2026-10-29 | 937 989 | 11 166 | 3 865 |
| 2026-10-30 | 71 759 | 11 355 | 4 022 |
| 2026-10-31 | 300 639 | 11 282 | 4 370 |
| 2026-11-01 | 605 193 | 12 195 | 4 526 |
| 2026-11-02 | 3 983 749 | 17 225 | 4 824 |

Referência Free [doc]: 5 000 000 leituras/dia, 100 000 escritas/dia. Em 02/11 as leituras chegaram a ~80 % do teto Free; as escritas ficaram em ~17 %. Pico horário de leitura na amostra: 02/11 02:00 UTC (~1,25 M rowsRead). `wrangler d1 info` no mesmo dia: `rows_read_24h ≈ 3,97 M`, `rows_written_24h ≈ 17 272`.

### 3.3 Telemetria `provider_http_attempt`

Instrumentação publicada a partir de `httpFirstSeenAt = 2026-10-30 06:00:33`. Janelas `days=7` e `days=30` do painel cobrem o **mesmo intervalo útil (~3 dias)**. Sucessos entram com peso 10 e amostragem ~10 % (`attempts = SUM(_sample_interval * double2)`); falhas 4xx/5xx entram com peso 1 e são contagem exata.

Agregado por provedor/contexto/status (estimativa de tentativas):

| Provider | Contexto | Status | attempts (est.) | events | avg_ms | max_ms |
|---|---|---|---|---|---|---|
| espn | discovery | 200 | 190 | 19 | 68 | 170 |
| espn | fallback | 200 | 90 | 9 | 171 | 500 |
| football-data | poller | 200 | 50 | 5 | 245 | 683 |
| football-data | discovery | 200 | 30 | 3 | 216 | 409 |
| espn | poller | 200 | 20 | 2 | 71 | 95 |
| football-data | discovery | **429** | **9** | **9** | 95 | 371 |
| espn | fallback | **403** | **1** | **1** | 37 | 37 |

`football_api_error` no overview (7d): erros de discovery com mensagem `429: Too Many Requests` em vários dias consecutivos às ~06:00 UTC; um 403 ESPN histórico em `bra.2` (Access Denied) em 28/10. Poller: 335 runs `ok`, 1 `error` no período.

Radar e `test-results-api.ts`: **sem** estes eventos. [lacuna]

### 3.4 Plano Cloudflare contratado

API de billing/subscriptions recusou o token OAuth do Wrangler (escopo insuficiente). `usage_model` dos Workers do projeto é `standard`. O discovery com F=11 e E=4 planeja 11 + 36 = 47 `fetch` mais consultas D1 numa invocação; o Free limita 50 subrequests e 10 ms de CPU em cron. A presença contínua de eventos de discovery no AE indica que a invocação completa, o que é incompatível com o teto Free de CPU de cron. **Inferência forte de Workers Paid; confirmação no painel de cobrança permanece [lacuna].**

### 3.5 Plano e cota football-data contratados

Não medidos nesta coleta (sem chamada autenticada ao provedor, sem leitura de secrets). Políticas oficiais: Free 10/min; Standard 30/min; planos superiores 60/min ([policies](https://docs.football-data.org/general/v4/policies.html), lida 02/11/2026). Páginas de preço de terceiros e a UI de pricing do fornecedor listam Standard em 60/min. **Inconsistência entre fontes primárias; confirmar com o fornecedor antes de comprar.** [doc + lacuna]

---

## 4. Dimensionamento de pico e saturação

Premissas: F=11, E=4 (medida); concorrência FD 4; pacing ESPN 1,3 s; ciclo poller 30 min; discovery 9 datas ESPN. [cálculo]

### 4.1 Discovery diário (pior caso atual)

- FD: 11 chamadas em rajadas de até 4 → com latência medida ~200 a 250 ms, as 11 saem em poucos segundos e ultrapassam 10/min se o fornecedor contar a janela de forma estrita. Os `429` diários em discovery confirmam a saturação local. [medida + cálculo]
- ESPN: 36 chamadas → ~(35)×1,3 s ≈ 45,5 s de pacing serializado no isolate.

### 4.2 Poller por ciclo

Com poucos jogos passados sem placar no instante da coleta, a carga efetiva do poller está baixa (telemetria: dezenas de tentativas FD/ESPN em ~3 dias). O teto estrutural permanece: até ~F×1 a 2 tarefas FD e ≤3E ESPN por ciclo, mais fallback ≤3F. Orçamento FD a 8/min × 30 min = 240 slots; o pior caso estrutural (~22 tarefas) cabe com folga se houver orçamento compartilhado. [cálculo]

### 4.3 Pontos de saturação

| Recurso | Quando deixa de atender | Evidência |
|---|---|---|
| FD 10/min sem coordenação | Rajada discovery / syncs coincidentes | `429` diários às 06:00 [medida] |
| ESPN pacing 1,3 s | Ciclo com dezenas de datas | Tempo de parede; 403 ocasional [medida] |
| D1 Free leituras/dia | ~5 M rowsRead | Dias com 2 a 4 M já observados [medida] |
| D1 Free escritas/dia | 100 k | Uso atual ~11 a 17 k; coordenação estimada +4 a 5 k/dia ainda cabe [medida + cálculo] |
| Queues Free retenção | Trabalho >24 h | Spec exige recuperação além de 24 h [doc] |
| Cron Free (5 triggers) | 5º slot para drenador | Já há 4 crons [código + doc] |

### 4.4 Quando a capacidade não atende à meta

Ordem sugerida de sacrifício (proposta, não aprovada): pausar radar (P4); adiar discovery (P3); restringir fallback a jogos além de +3 h (P2); manter resultado pendente visível sem inventar placar (P0); alertar idade da pendência no painel. Meta de atraso de resultado na spec: início previsto + 3 h, excluindo adiados.

---

## 5. Alternativas de coordenação

Comparação com docs oficiais lidas em 02/11/2026. Custos marginais abaixo assumem o volume de coordenação da ordem de milhares de operações/dia, não o tráfego HTTP do produto.

| Alternativa | Resolve | Limite relevante | Custo Free (docs) |
|---|---|---|---|
| **A. D1** razão + fila (`UPDATE…RETURNING`, batch) | Orçamento comum Worker + Actions; retenção sob controle do projeto; harness de teste atual | Escrita/leitura diária; D1 single-threaded | 100 k writes/dia, 5 M reads/dia |
| **B. Durable Object** + alarme | Serialização + retomada sem drenador | Nova classe; radar precisa de rota HTTP; harness exige fake de storage | 100 k req/dia, 13 k GB-s/dia, SQLite only no Free |
| **C. Queues** | Desacopla produtor/consumidor | Retenção Free **24 h fixa**; sem rate limit de provedor | 10 k ops/dia |
| **D. Workflows** | Sleep longo | Orçamento global ainda precisa de coordenador | 3 k steps/dia Free |
| **E. KV** | n/a | Descartado: 1 escrita/s na mesma chave; Free 1 k writes/dia | n/a |
| **F. Rate Limiting binding** | Barreira local | Descartado como orçamento global (por localização, aproximado) | n/a |
| **G. Só GitHub Actions** | Já usado no radar | Sem persistência de fila de produto; schedule pode atrasar | n/a |
| **H. Manter atual** | Zero mudança | Sem orçamento entre isolates/processos; é o problema da spec | n/a |

**Por que Queues sozinhas não fecham a spec:** retenção Free 24 h ([pricing Queues](https://developers.cloudflare.com/queues/platform/pricing/), 30/10/2026) e ausência de deduplicação/prioridade nativas para trabalho de resultado que precisa sobreviver a falhas longas.

---

## 6. Hipótese D1 e critérios de decisão

### 6.1 Hipótese (candidata do operador)

1. Tabelas D1 para razão de orçamento por `(provedor, credencial)` e fila de trabalho com deduplicação, prioridade, lease, `not_before` e estados (`pending`/`leased`/`done`/`expired`/`blocked`).
2. Camada única no Worker: reserva slot → `fetch` → grava resultado/cabeçalhos → telemetria (`provider_http_attempt`).
3. Cron drenador a cada 1 a 5 min (ocupa o 5º slot Free ou usa folga Paid).
4. Radar: exceção documentada, reserva em lote no D1, ou migração para o Worker (decisão aberta).
5. Evolução para DO + alarme se a medição mostrar contenção no D1 ou se o drenador for indesejável.

Schema final, valores de retenção e prioridades **não estão aprovados** neste documento.

### 6.2 Critérios para aceitar D1

| Critério | Como verificar | Estado em 02/11/2026 |
|---|---|---|
| Escritas de coordenação cabem na margem Free ou a conta é Paid | Estimar writes/tentativa × volume AE; comparar a `rows_written` diário | Escritas atuais ~11 a 17 k/dia; +~5 k/dia de coordenação ainda <100 k Free. Leituras do produto já flertam com 5 M Free. |
| `RETURNING` atômico sob carga real | Já usado em `request_limits`; teste de contenção na fila nova | Suporte confirmado no código de produção; contenção da fila nova ainda não medida. |
| Recovery >24 h | Itens em D1, não só em Queue Free | Atende por desenho. |
| Radar e sync manual no orçamento ou exceção explícita | Decisão do operador | Aberta. |
| Discovery deixa de gerar `429` sistemático | Após implantar orçamento, observar AE | Hoje falha: critério de sucesso futuro. |
| Confirmação do plano Cloudflare | Painel de billing | Lacuna (OAuth Wrangler sem escopo de billing). |

### 6.3 Critérios para preferir DO (ou híbrido)

- Contenção medida no D1 (fila de queries / overloaded) sob o tráfego de produto + coordenação.
- Necessidade de reação sub-minuto (alarme) sem quinto cron.
- Operador aceita nova classe, migração e fake no harness de teste.

### 6.4 Trade-offs do radar

O radar (~40 chamadas ESPN/dia) foge do mutex e da telemetria do Worker. Opções: (a) exceção com cota ESPN reservada; (b) reserva em lote no D1 antes da coleta; (c) mover a coleta para o Worker (custa um cron; no Free compete com o drenador).

---

## 7. Migração dos consumidores (proposta)

Ordem alinhada aos tickets 02 (football-data) e 03 (ESPN); **não implementada neste ticket**.

1. Camada de acesso única no Worker (reserva + fetch + telemetria).
2. Poller, discovery, fallback e `POST /matches/sync` passam a usá-la; sync manual conta no orçamento com prioridade própria.
3. Registrar exceção ou integração do radar e do script local `test-results-api.ts`.
4. Inventário humano de outros clientes da mesma chave FD fora do repositório.

---

## 8. Cenários de sobrecarga

| Cenário | Sintoma esperado | Resposta desejada |
|---|---|---|
| Discovery FD com 11 competições sem pacing global | `429` às 06:00 (já observado) | Reservar slots 8/min; serializar além da concorrência 4 |
| Muitas competições ESPN + fallback no mesmo ciclo | Duração de parede alta; risco de 403 | Priorizar P0/P1; adiar discovery/radar |
| Leituras D1 perto de 5 M/dia no Free | Queries falham ao estourar cota | Otimizar queries do produto (já houve índice em #622); coordenação deve ser barata em reads |
| Falha ESPN >24 h | Resultados pendentes além da janela atual de resgate | Fila durável em D1; alerta +3 h; sem placar inventado |
| Conta Free e quinto cron | Drenador ou radar no Worker bloqueado | Paid, fundir crons, ou DO com alarme |

---

## 9. Lacunas e amostragem

- Janela AE de `provider_http_attempt`: desde 30/10/2026 (~3 dias úteis na coleta). Sucessos amostrados; picos por minuto não expostos no endpoint `/metrics/ops`.
- Radar e scripts locais fora do AE.
- Plano Cloudflare de cobrança: não lido (API 401 no token atual).
- Plano FD contratado, atraso de placares Free, janela fixa vs deslizante, consumo de cota em 429: não confirmados com o fornecedor.
- Divergência Standard 30/min (policies) × 60/min (pricing / fontes secundárias).
- Termos ESPN / autorização de uso no Brasil: fora desta coleta (ticket 04).
- Contenção D1 sob a fila nova: só após implementação instrumentada.
- Forma da carga em “dia cheio” de jogos: o instante da coleta tinha pouca pendência passada; fins de semana longos ainda precisam de mais semanas de AE.

Amostra mínima sugerida antes de cravar parâmetros de orçamento: 2 a 4 semanas com rodadas de meio de semana e fins de semana, lendo `provider_http_attempt` e `football_api_error` sem gerar carga artificial.

---

## 10. Fontes

Cloudflare (lidas 02/11/2026):

- Workers limits: <https://developers.cloudflare.com/workers/platform/limits/> (atualizada 29/10/2026)
- D1 limits: <https://developers.cloudflare.com/d1/platform/limits/> (30/10/2026)
- D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/> (30/10/2026)
- Queues pricing: <https://developers.cloudflare.com/queues/platform/pricing/> (30/10/2026; Free retention 24 h)
- Queues limits: <https://developers.cloudflare.com/queues/platform/limits/> (30/10/2026)
- Durable Objects pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing/> (18/10/2026)

football-data.org:

- Policies (throttling): <https://docs.football-data.org/general/v4/policies.html>
- Lookup tables (cabeçalhos): <https://docs.football-data.org/general/v4/lookup_tables.html>
- Pricing UI: <https://www.football-data.org/pricing> (renderização parcial; taxas de planos pagos confirmadas na policy e em resumos de terceiros com a ressalva da inconsistência 30×60)

Medições internas:

- `wrangler d1 execute palpitae --remote` (SELECT)
- `wrangler d1 info palpitae`
- GraphQL `d1AnalyticsAdaptiveGroups` (26/10 a 02/11/2026)
- `GET /metrics/ops` e `/metrics/overview` via sessão admin em palpitae.com.br

Código: `api/wrangler.toml`, `api/src/index.ts`, `api/src/matches/{sync,poller,fixtureDiscovery,espnFallback,espnSync,footballDataQuota,espnQuota}.ts`, `api/src/providers/espn.ts`, `api/src/observability/{providerHttp,metricsRouter}.ts`, `api/src/security/limits.ts`, `api/src/radar/espnRadar.ts`, `.github/workflows/radar-sync.yml`.
