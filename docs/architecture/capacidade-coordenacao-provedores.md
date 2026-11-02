# Capacidade e coordenação das chamadas aos provedores

Documento de arquitetura do ticket 01 da epic de resiliência de serviços. Registra inventário, medições disponíveis, comparação de alternativas e a **hipótese D1** escolhida pelo operador como candidata sujeita a critérios. **Não é ADR fechada:** a decisão definitiva depende das medições contínuas e das escolhas listadas na seção de critérios. O ticket permanece aberto.

**Base de código (coleta inicial):** `aa5f20a`.  
**Base de código (revisão 02/11 noite):** `10bb225` em `origin/main`, com `#622` e `#624` já deployados na API.  
**Coleta inicial:** 2026-11-02 (tarde).  
**Revisão de medições:** 2026-11-02 (noite, UTC).  
**Pesquisa prévia (local, fora do Git):** no worktree principal, `.scratch/research/capacidade-coordenacao-provedores.md` (30/10/2026, base `9f0ad95`). Esse arquivo fica só no scratch local excluído do repositório.  
**Coleta detalhada de produção (local, fora do Git):** `.scratch/research/capacidade-coordenacao-coleta-2026-11-02.md` no worktree principal. Agregados operacionais precisos (contagens de jogos, série diária/horária D1, tamanho de banco, margens exatas de cota, tabela fina do AE, meta do protótipo local) ficam ali e **não** entram neste documento versionado.

Rótulos: **[código]** lido neste SHA; **[doc]** documentação oficial lida nesta coleta; **[medida]** produção via acesso existente (D1 remoto RO, GraphQL D1, SQL API do Analytics Engine, settings Workers); **[cálculo]** derivado de código + doc + medida com premissa explícita; **[hipótese]** não verificado; **[lacuna]** dado indisponível; **[amostra insuficiente]** medido, janela curta demais para fechar parâmetro; **[protótipo local]** experimento isolado, não medição do D1 de produção.

---

## 1. Conclusões sustentadas

1. A demanda aos provedores de partidas cresce com competições ativas e jogos na janela, não com usuários. [código + cálculo]
2. Há `429` recorrentes no discovery perto de 06:00 UTC. A causa única não está provada: o poller dispara no mesmo minuto (`0,30 * * * *`), a concorrência FD é 4 e o espaçamento entre chamadas depende da latência e do trabalho D1 entre `fetch`. Hipótese de trabalho: a rajada do discovery satura a cota local de 10/min quando o fornecedor conta a janela de forma estrita. [medida + hipótese]
3. O volume médio de tentativas HTTP instrumentadas parece baixo frente a 10 req/min sustentados. A amostragem de sucessos no app (~10 %), a amostragem eventual do Analytics Engine (`_sample_interval`) e a ausência do radar no AE limitam a precisão do pico. [medida + código + doc]
4. Queues no plano Free retêm mensagens **24 h fixas**, abaixo da recuperação exigida pela spec (>24 h). Estado durável de trabalho pendente não pode viver só em mensagens Free. [doc]
5. O padrão `INSERT … ON CONFLICT … DO UPDATE … RETURNING` já roda em produção no D1 (`api/src/security/limits.ts`). Forma usada em `consumeLimit`:

   ```sql
   INSERT INTO request_limits (bucket_key, window_start, hits, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (bucket_key) DO UPDATE SET
       hits = CASE WHEN request_limits.window_start >= excluded.window_start
         THEN request_limits.hits + 1 ELSE 1 END,
       window_start = MAX(request_limits.window_start, excluded.window_start),
       expires_at = MAX(request_limits.expires_at, excluded.expires_at)
     WHERE request_limits.window_start < excluded.window_start
        OR request_limits.hits < ?
     RETURNING hits
   ```

   [código]
6. Em alguns dias do calendário UTC e em janelas móveis de 24 h, as leituras do D1 de produto já se aproximam do teto Free (5 M rowsRead/dia). As escritas ficam em faixa bem inferior ao teto Free (100 k rowsWritten/dia). Na revisão da noite de 02/11, a série horária mostra picos grandes **antes** do deploy do índice `#622`; depois do deploy as horas medidas ficam bem mais baixas, mas **ainda não há um dia civil completo pós-`#622`/`#624`**. Qualquer coordenação em D1 precisa ser medida contra essas cotas e contra um dia cheio pós-índice. Contagens e margens percentuais exatas ficam só no scratch local. [medida + doc + amostra insuficiente]
7. **Hipótese D1 (candidata, não decisão fechada):** razão de orçamento + fila de trabalho em tabelas D1, com camada única de acesso no Worker e drenador por cron. Durable Object com alarme permanece alternativa se houver contenção medida ou se o operador eliminar o drenador. [hipótese + critério]
8. O plano Cloudflare contratado permanece **desconhecido**. Settings do script e da conta devolvem `usage_model` / `default_usage_model` = `standard`. A documentação oficial afirma que o plano Workers Paid **tem acesso** ao modelo Standard; isso é implicação Paid → Standard, **não** prova o inverso (Standard → Paid). Endpoints de billing/subscriptions com o OAuth do Wrangler continuam inacessíveis (403). Fatura e inscrição no painel **não foram lidas**. Sem cobrança confirmada, qualquer leitura de cotas D1 Paid fica condicional. [medida + doc + lacuna]

---

## 2. Inventário de chamadores

Fonte: árvore em `aa5f20a`. Nomes de secrets apenas; valores não lidos.

### 2.1 football-data.org

Cliente: `fetchMatchesFromApi` em `api/src/matches/sync.ts`. Token `FOOTBALL_API_KEY`. Retry único após 6 s em HTTP 429 (`FD_RETRY_BACKOFF_MS`). Concorrência por execução: `FD_MAX_CONCURRENT_REQUESTS = 4`. Sem leitura dos cabeçalhos de cota na chamada.

| Chamador | Gatilho | Chamadas por execução (sem retry) |
|---|---|---|
| Poller (`pollActiveMatches`) | cron `0,30 * * * *` | 1 por (competição, rodada) com jogo na janela ativa ou de resgate |
| Discovery (`discoverFixtures`) | cron `0 6 * * *` | 1 por competição FD com `status != finished` |
| `POST /matches/sync` | admin (`ADMIN_EMAIL`) | 1 |
| `api/scripts/test-results-api.ts` | manual local | ilimitado; fora da telemetria do Worker |

Janelas do poller [código, `matchPollingWindow.ts`]: ativa de `start + 115 min` até `start + 200 min`; resgate até `start + 24 h` (`RESCUE_WINDOW_MS`). Isso é distinto do parâmetro `days=7` do painel de métricas (janela de consulta AE) e da janela ESPN de discovery (ontem UTC até hoje+7 dias = 9 datas).

### 2.2 ESPN

Cliente: `fetchEspnScoreboard` em `api/src/providers/espn.ts`. Sem credencial. Mutex por isolate, `ESPN_MIN_INTERVAL_MS = 1300`, timeout 10 s, retry em 429/5xx. Concorrência de syncs: `ESPN_MAX_CONCURRENT_COMPETITIONS = 2`.

| Chamador | Gatilho | Chamadas por execução (sem retry) |
|---|---|---|
| Discovery ESPN-primária | `0 6 * * *` | 9 datas × E competições (ontem UTC … hoje+7) |
| Poller ESPN-primária | `0,30 * * * *` | até 3 datas por competição quando jogos pendentes abrangem dois dias UTC (dia do jogo e o anterior) |
| Fallback (`scoreWindowFromEspn`) | após sync do poller em competições FD | até 3 datas por competição FD elegível |
| `POST /matches/sync` (código ESPN) | admin | lista `dates` validada só como `YYYYMMDD[]`; **sem teto de nove** em `validateSyncParams` / `isValidDatesList` |
| Radar (`radar-sync.yml` + `radarSync.ts`) | GitHub Actions `0 7 * * *` | 40 slugs (`ESPN_LEAGUES`) + Wikimedia pageviews |

O radar grava no D1 via `wrangler d1 execute --remote` e **não** emite `provider_http_attempt`. Um orçamento só no isolate do Worker **não** cobre o radar em Actions até haver integração explícita (reserva remota, rota HTTP ou migração para o Worker).

### 2.3 Outros processos externos

Resend (lembretes), Google OAuth, Analytics Engine SQL API, scripts locais. Fora do escopo de coordenação de partidas neste documento (tickets 06/07).

### 2.4 Crons do Worker

Quatro triggers em `api/wrangler.toml`: poller `:00/:30`, export AE `5 0 * * *`, lembretes `0 10 * * *`, discovery `0 6 * * *`. Limite Free de Cron Triggers por conta: 5. [doc + código]

---

## 3. Medições de produção (2026-11-02)

Nenhuma chamada nova foi feita a football-data.org ou ESPN nesta coleta nem na revisão da noite. Leituras: D1 remoto (SELECT), GraphQL `d1AnalyticsAdaptiveGroups` (dia e hora), `wrangler d1 info`, SQL API do Analytics Engine com credencial de conta já presente no ambiente de desenvolvimento local (valor não exposto), settings Workers via OAuth Wrangler. Painel admin no browser e dashboards de billing/FD ficaram de fora na revisão da noite (CDP indisponível). Números finos ficam na coleta local citada no cabeçalho.

### 3.1 Inventário D1 remoto

Competições com `status != finished` (descoberta e poller) na coleta:

| Provider | Quantidade efetiva | Observação |
|---|---|---|
| football-data | F ≈ ordem de uma dezena (ongoing + upcoming) | usa-se F nas contas estruturais |
| espn | E na ordem das unidades (pilot + public) | usa-se E nas contas estruturais |

No instante da coleta/revisão havia pouca pendência passada sem placar; a maior parte das linhas sem `scored_at` era jogo futuro. Contagens exatas de jogos e tamanho do banco ficam só na coleta local.

### 3.2 Uso D1

Referência Free [doc](https://developers.cloudflare.com/d1/platform/pricing/): 5 000 000 leituras/dia, 100 000 escritas/dia.

Dois tipos de janela aparecem nas ferramentas e **não são intercambiáveis**:

| Janela | Origem típica | O que mede |
|---|---|---|
| Dia de calendário UTC | GraphQL `d1AnalyticsAdaptiveGroups` por dia | rowsRead / rowsWritten daquele dia civil UTC (parcial no dia corrente) |
| 24 h móvel | `wrangler d1 info` (`rows_read_24h`, `rows_written_24h`) | acumulado nas últimas 24 h a partir do instante da consulta |

Na amostra de fim de outubro a 02/11/2026, leituras em alguns dias de calendário e na janela móvel de 24 h chegaram à **faixa alta do teto Free** (ordem de milhões de rowsRead). Escritas permaneceram em **faixa baixa** frente a 100 k/dia (ordem de dezenas de milhares).

Revisão noturna (GraphQL horário + `wrangler d1 info`): o dia civil 02/11 UTC ainda carrega picos da manhã **anteriores** ao índice `#622`; a soma das horas pós-deploy fica em **faixa bem menor**, ainda sem um dia civil completo pós-`#622`/`#624`. O corpo da PR `#624` registra que, após os índices da `#622`, as leituras medidas no cenário de teste caíram para cerca de 2 % do teto Free — evidência de **plano de consulta / cópia local**, distinta de um dia civil completo em produção. Declarar a nova baseline exige pelo menos um dia civil UTC inteiro pós-deploy (e preferencialmente uma semana). Série horária, totais e margens percentuais exatas ficam na coleta local. [medida + amostra insuficiente]

### 3.3 Telemetria `provider_http_attempt`

Instrumentação publicada a partir de `httpFirstSeenAt ≈ 2026-10-30 06:00 UTC`. Os parâmetros `days=7` e `days=30` do painel cobrem o **mesmo intervalo útil** (poucos dias desde a publicação), não sete dias cheios de poller.

Camadas de amostragem [código + doc AE]:

1. **App:** falhas (4xx/5xx e status `0`) são sempre emitidas com peso `double2 = 1`; sucessos 2xx/3xx entram com probabilidade `HTTP_SUCCESS_SAMPLE_RATE = 0.1` e peso `double2 = 10` (`api/src/observability/providerHttp.ts`).
2. **Analytics Engine:** cada linha carrega `_sample_interval`. Contagens usam `SUM(_sample_interval)` / `SUM(_sample_interval * double2)`. Se `_sample_interval > 1`, **falhas deixam de ser contagem exata** e passam a estimativa. Sucessos já são estimativa pelo peso 10; com poucos `events` a estimativa é pouco precisa. `MAX(double1)` / `max_ms` reflete só os sucessos (e falhas) que entraram na amostra gravada. Ver [Sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/).

Amostragem Cloudflare observada via SQL API na revisão da noite: **leve** (`AVG(_sample_interval)` pouco acima de 1 no dataset e em `provider_http_attempt`). Valores numéricos exatos ficam só no scratch local. Falhas permanecem quase contagem exata nesta janela; sucessos continuam estimativa pelo peso 10 do app. [medida]

Leitura qualitativa da amostra curta: sucessos ESPN/FD em discovery, poller e fallback na ordem de dezenas a poucas centenas de tentativas estimadas; vários eventos `429` no discovery FD perto de 06:00 UTC; poucos `403` ESPN (fallback/poller). Poller com maioria de runs `ok` e falha rara no período. Radar e `test-results-api.ts` sem estes eventos. Pico por minuto continua **ausente** do endpoint `/metrics/ops`. [medida + amostra insuficiente]

### 3.4 Plano Cloudflare contratado

Leituras com OAuth Wrangler (escopos de account/user/workers/d1; **sem** billing):

| Fonte | Resultado |
|---|---|
| Settings do script `palpitae-api` e account-settings | `usage_model` / `default_usage_model` = `standard` |
| Endpoints de subscriptions / billing profile | inacessíveis com este OAuth (**403**) |
| Painel de cobrança no browser | **não lido** (CDP indisponível na revisão) |

Documentação Cloudflare de pricing Workers (lida 02/11/2026): *"Users on the Workers Paid plan have access to the Standard usage model."* Modelos legados citados: Bundled e Unbound. A frase documenta disponibilidade do Standard **para** quem já está no Paid; **não** estabelece que `usage_model=standard` prove inscrição Paid (Enterprise e casos legados podem diferir; a fatura não foi lida). O plano contratado permanece **[lacuna]**. [medida + doc + lacuna]

Efeito **condicional** se a conta for Workers Paid [doc](https://developers.cloudflare.com/workers/platform/pricing/): cotas D1 passam a inclusões mensais (leituras e escritas na ordem de bilhões/dezenas de milhões), em vez de 5 M / 100 k por dia no Free. Isso mudaria a folga da hipótese D1, **sem** autorizar fechar a ADR antes da confirmação de cobrança e de um dia civil pós-`#622`.

Limites relevantes Free vs Paid [doc](https://developers.cloudflare.com/workers/platform/limits/):

- Subrequests por invocação: 50 (Free) / 10 000 (Paid). Cada `fetch` e cada consulta a serviços internos (inclui D1) conta.
- CPU time em Cron Trigger: 10 ms (Free) / 30 s ou 15 min conforme intervalo (Paid). **CPU mede só execução ativa; espera em `fetch`, D1 e I/O não entra no CPU time.**

No discovery com F e E da coleta, o plano de chamadas HTTP sozinho fica na ordem de ~F + 9E (dezenas, abaixo de 50). Isso **não prova** estouro do teto de 50 subrequests no Free, porque faltam as consultas D1 da mesma invocação e retries. Completar o discovery no AE também **não prova** Workers Paid: a invocação pode completar no Free se o tempo de parede for majoritariamente espera de rede.

### 3.5 Plano e cota football-data contratados

Plano contratado da conta **não lido** nesta revisão: sem chamada autenticada ao provedor (carga artificial proibida) e sem área logada no browser. O código assume Free 10/min (`FD_FREE_REQUESTS_PER_MINUTE` em `footballDataQuota.ts`) e comenta o header `X-Requests-Available-Minute`. A documentação oficial de lookup tables (lida 02/11/2026) nomeia os cabeçalhos de resposta como `X-RequestsAvailable` e `X-RequestCounter-Reset`. Há divergência de nome entre comentário do código e a tabela oficial. [código + doc + lacuna]

Políticas oficiais: Free 10/min; Standard 30/min; planos superiores 60/min ([policies](https://docs.football-data.org/general/v4/policies.html), lida 02/11/2026). A [UI de pricing](https://www.football-data.org/pricing) e resumos de terceiros listam Standard em 60/min. **Divergência entre fontes primárias (30/min na policy × 60/min em pricing/terceiros); confirmar com o fornecedor antes de comprar.** [doc + lacuna]

Meio seguro para fechar a lacuna sem rajada: uma leitura autenticada de recurso barato (ex.: lista de competições) observando só os cabeçalhos de cota, ou abrir a área da conta no browser já logado. Não feito nesta revisão.

---

## 4. Dimensionamento de pico e saturação

Premissas estruturais: F e E da seção 3.1; concorrência FD 4; pacing ESPN 1,3 s; ciclo poller 30 min; discovery 9 datas ESPN. [cálculo]

### 4.1 Discovery diário (pior caso estrutural)

- FD: F chamadas em rajadas de até 4. Com latência de rede na ordem de poucas centenas de ms, as chamadas saem em poucos segundos. Se o fornecedor aplicar 10/min em janela estrita, a rajada pode saturar. Os `429` perto de 06:00 UTC são evidência de pressão; a atribuição exclusiva ao discovery permanece hipótese (coincidência com o poller, concorrência e trabalho entre chamadas). [medida + hipótese + cálculo]
- ESPN: 9E chamadas com pacing ~1,3 s entre inícios no isolate.

### 4.2 Poller por ciclo

Com pouca pendência passada no instante da coleta, a carga efetiva do poller estava baixa (telemetria de tentativas na ordem de dezenas em poucos dias). O teto estrutural permanece: até ~F×1 a 2 tarefas FD e datas ESPN por competição com pendência, mais fallback ≤3F. Orçamento FD a 8/min × 30 min = 240 slots; o pior caso estrutural (~2F tarefas) cabe com folga **se** houver orçamento compartilhado entre isolates e processos. [cálculo]

### 4.3 Capacidade D1 da coordenação (fórmula, sem viabilidade declarada)

Drenador a cada 5 min → \(288\) varreduras/dia; a cada 1 min → \(1440\) varreduras/dia.

Estimativa de escritas de coordenação (hipótese de dimensionamento, **sem medida de produção**):

\[
W_{\text{dia}} \approx V \times (w_{\text{lease}} + w_{\text{ack}}) + W_{\text{reserva HTTP}}
\]

onde \(V \in \{288, 1440\}\) (ou outro intervalo escolhido), \(w_{\text{lease}}\) / \(w_{\text{ack}}\) são writes por item processado na fila, e \(W_{\text{reserva HTTP}}\) são writes da razão por tentativa HTTP.

Estimativa de leituras:

\[
R_{\text{dia}} \approx V \times r_{\text{scan}} + R_{\text{reserva}}
\]

\(r_{\text{scan}}\) depende de **índices**, da largura do `SELECT` (rows tocadas), de `LIMIT`/paginação e da **concorrência** com o tráfego de produto no mesmo D1 single-threaded. Sem medir \(w_*\) e \(r_{\text{scan}}\) sob carga real, **não se declara** que a coordenação cabe na margem Free de escritas ou leituras. Qualquer cifra do tipo “+4 a 5 mil escritas/dia” sem derivação medida fica apenas como **[hipótese]** descartada deste documento até haver experimento.

#### Meios seguros para estimar \(w_*\) e \(r_{\text{scan}}\)

Ordem preferida (nenhuma altera o D1 `palpitae` de produção nem chama provedores externos):

1. **Worker local + D1 Miniflare** (`wrangler dev` com `database_id` fictício e estado em disco local). O binding devolve `meta.rows_read` / `meta.rows_written` por statement. O harness de teste `createSqliteD1` **não** expõe essas métricas (só `changes`). O CLI `wrangler d1 execute --local` também omite rows lidas/escritas.
2. **D1 remoto isolado** (banco novo na mesma conta, nome distinto de `palpitae`), medindo `meta` no Worker ou GraphQL `d1AnalyticsAdaptiveGroups` só desse `databaseId`, depois apagar o banco. Consome cota da conta; não toca dados de produto.
3. **Piloto instrumentado no D1 de produto** só depois dos itens acima e com telemetria de `meta` por operação de coordenação. Fora do escopo desta revisão.

#### Protótipo Miniflare (revisão 02/11 noite) — método e limites

Foi rodado um protótipo local isolado (fila + razão com índice `(state, not_before, priority, id)`). **Não é medição do D1 de produção** e **não substitui** o item 2 acima.

Limites do método:

- Um processo local; sem contenção multi-isolate.
- Plano de consulta / estatísticas do Miniflare podem diferir do D1 remoto.
- Volume de seed e `LIMIT` de lease são escolhas do experimento, não carga real.
- Extrapolação diária a partir desses `meta` é **ilustrativa** e permanece **[hipótese]** / **[protótipo local]**.

Observações qualitativas úteis (valores numéricos exatos só no scratch):

- O `SELECT` de drenagem com `LIMIT` pequeno ainda leu **muitas** linhas relativas ao lote — plano/índice a inspecionar antes de cravar fórmula.
- Lease com `UPDATE…RETURNING` custou da ordem de **duas escritas por item** nesta medição local (linha + índice).
- Reserva de razão no padrão de `consumeLimit`: primeira inserção escreve; hits seguintes escrevem 1; balde cheio escreve 0.
- Sob premissas agressivas de drenagem (centenas de varreduras/dia com lote cheio), a ordem de grandeza local sugere que escritas de coordenação podem ser **materiais** frente ao teto Free de 100 k/dia, e leituras **secundárias** frente a 5 M — **se** o produto pós-`#622` permanecer baixo. No teto Paid mensal a folga seria larga **se** Paid for confirmado. Nenhuma dessas frases declara viabilidade. [protótipo local + cálculo + amostra insuficiente]

### 4.4 Pontos de saturação

| Recurso | Quando deixa de atender | Evidência |
|---|---|---|
| FD 10/min sem coordenação | Rajada discovery / syncs coincidentes | `429` perto de 06:00 UTC [medida]; causa única [hipótese] |
| ESPN pacing 1,3 s | Ciclo com dezenas de datas | Tempo de parede; 403 ocasional [medida] |
| D1 Free leituras/dia | ~5 M rowsRead | Dias / 24 h móveis já na faixa alta do teto [medida] |
| D1 Free escritas/dia | 100 k | Uso atual em faixa baixa; custo da coordenação ainda só em protótipo local [medida + protótipo local] |
| Queues Free retenção | Trabalho >24 h | Spec exige recuperação além de 24 h [doc] |
| Cron Free (5 triggers) | 5º slot para drenador | Já há 4 crons [código + doc] |

### 4.5 Quando a capacidade não atende à meta

Ordem sugerida de sacrifício (proposta, não aprovada): pausar radar (P4); adiar discovery (P3); restringir fallback a jogos além de +3 h (P2); manter resultado pendente visível sem inventar placar (P0); alertar idade da pendência no painel. Meta de atraso de resultado na spec: início previsto + 3 h, excluindo adiados.

---

## 5. Alternativas de coordenação

Comparação com docs oficiais lidas em 02/11/2026. Custos marginais abaixo assumem volume de coordenação na ordem de milhares de operações/dia, sujeito à medição da seção 4.3.

| Alternativa | Resolve | Limite relevante | Custo Free (docs) |
|---|---|---|---|
| **A. D1** razão + fila (`INSERT…ON CONFLICT…DO UPDATE…RETURNING`, batch) | Orçamento comum entre isolates do Worker; retenção sob controle do projeto; harness de teste atual. Radar em Actions só entra com integração explícita | Escrita/leitura diária; D1 single-threaded | 100 k writes/dia, 5 M reads/dia |
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
4. Radar: exceção documentada, reserva em lote no D1 antes do Actions, ou migração para o Worker (decisão aberta). Sem um desses passos, o orçamento do Worker não cobre o radar.
5. Evolução para DO + alarme se a medição mostrar contenção no D1 ou se o drenador for indesejável.

Schema final, valores de retenção e prioridades **não estão aprovados** neste documento.

### 6.2 Critérios para aceitar D1

| Critério | Como verificar | Estado em 02/11/2026 (revisão noite) |
|---|---|---|
| Escritas e leituras de coordenação cabem na margem Free ou a conta é Paid | Medir \(w_*\) e \(r_{\text{scan}}\) (protótipo local feito; falta D1 remoto isolado + dia civil pós-`#622`); comparar a cotas | Produto: escritas baixas; leituras do dia 02/11 altas por picos pré-índice. Coordenação: só ordem de grandeza local sob premissas do §4.3 — **não** é medição de produção. Viabilidade Free **não declarada**. Cotas D1 Paid só entram se o plano for confirmado. |
| `RETURNING` atômico sob carga real | Já usado em `request_limits`; teste de contenção na fila nova | Suporte confirmado no código de produção; protótipo local reproduziu reserva e lease com `RETURNING`. Contenção multi-isolate ainda não medida. |
| Recovery >24 h | Itens em D1, não só em Queue Free | Atende por desenho. |
| Radar e sync manual no orçamento ou exceção explícita | Decisão do operador; sync ESPN manual já aceita lista `dates` sem teto de nove | Aberta. Avaliação do radar no §6.4. |
| Discovery deixa de gerar `429` sistemático | Após implantar orçamento, observar AE com ciência da amostragem | Hoje há `429`; critério de sucesso futuro. |
| Confirmação do plano Cloudflare | Painel de billing ou fatura | `usage_model=standard` observado; doc não prova Paid; billing API 403; fatura não lida. Plano **desconhecido**. |

### 6.3 Critérios para preferir DO (ou híbrido)

- Contenção medida no D1 (fila de queries / overloaded) sob o tráfego de produto + coordenação.
- Necessidade de reação sub-minuto (alarme) sem quinto cron.
- Operador aceita nova classe, migração e fake no harness de teste.

### 6.4 Avaliação do radar de competições

Escopo desta seção: o radar de `/admin/oportunidades` (Actions + D1), não o produto Cloudflare Radar de telemetria de internet.

Estado atual [código + medida de workflow]:

- Workflow `.github/workflows/radar-sync.yml`, cron `0 7 * * *` (após o discovery 06:00 UTC).
- `ESPN_LEAGUES` tem **40** slugs; coleta com concorrência 5 (`ESPN_CONCURRENCY`) via `fetchEspnScoreboard`; pageviews Wikimedia à parte.
- Gravação: `wrangler d1 execute palpitae --remote --file=radar.sql` com token CI. Sem `provider_http_attempt`.
- Execuções recentes (GitHub Actions): sucesso em 30/10, 31/10, 01/11 e 02/11/2026.
- Comentário no `wrangler.toml`: a coleta permanece no Actions por escolha herdada da ADR-014 (antes API-Football por IP); ESPN hoje não impõe a mesma barreira de IP.

Impacto na coordenação:

| Aspecto | Avaliação |
|---|---|
| Volume HTTP | Dezenas de fetches ESPN/dia + Wikimedia; baixo frente ao discovery ESPN (9E) e ao teto FD 10/min |
| Orçamento Worker | Fora do isolate; um rate limit só no Worker **não** cobre o radar até integração explícita |
| D1 | Escritas diárias do snapshot (SQL gerado); volume típico pequeno frente às escritas de produto, mas entra na mesma cota do banco `palpitae` |
| Telemetria | Cego no AE de provedores; falhas ESPN do radar não aparecem em `provider_http_attempt` |
| Quinto cron Free | Mover o radar para o Worker compete com o drenador da hipótese D1 |

Opções (ainda abertas ao operador): (a) exceção documentada com cota ESPN reservada fora do orçamento do Worker; (b) reserva em lote no D1 antes do job Actions; (c) migrar a coleta para o Worker (cron ou alarme DO). Enquanto a decisão não fecha, a hipótese D1 deve tratar o radar como **consumidor externo** do D1 e da ESPN.

---

## 7. Migração dos consumidores (proposta)

Ordem alinhada aos tickets 02 (football-data) e 03 (ESPN); **não implementada neste ticket**.

1. Camada de acesso única no Worker (reserva + fetch + telemetria).
2. Poller, discovery, fallback e `POST /matches/sync` passam a usá-la; sync manual conta no orçamento com prioridade própria. Sync ESPN manual pode enviar mais de nove datas.
3. Registrar exceção ou integração do radar e do script local `test-results-api.ts`.
4. Inventário humano de outros clientes da mesma chave FD fora do repositório.

---

## 8. Cenários de sobrecarga

| Cenário | Sintoma esperado | Resposta desejada |
|---|---|---|
| Discovery FD com dezenas de competições sem pacing global, coincidente com poller | `429` perto de 06:00 (já observado; causa única em aberto) | Reservar slots 8/min; serializar além da concorrência 4 |
| Muitas competições ESPN + fallback no mesmo ciclo | Duração de parede alta; risco de 403 | Priorizar P0/P1; adiar discovery/radar |
| Leituras D1 perto de 5 M/dia no Free | Queries falham ao estourar cota | Otimizar queries do produto (índice em #622); coordenação deve ser barata em reads e medida |
| Falha ESPN >24 h | Resultados pendentes além da janela atual de resgate | Fila durável em D1; alerta +3 h; sem placar inventado |
| Conta Free e quinto cron | Drenador ou radar no Worker bloqueado | Paid, fundir crons, ou DO com alarme |

---

## 9. Lacunas e amostragem

Classificação após a revisão da noite de 02/11/2026:

**Reduzidas nesta revisão (sem publicar agregados finos)**

- Amostragem AE: observada como **leve** via SQL API; valores exatos só no scratch.
- Inventário F/E em faixas amplas; contagens exatas só no scratch.
- `usage_model=standard` nos settings Workers; **plano contratado ainda desconhecido** (doc não prova Paid).
- Meio seguro para estimar custo da fila D1: protótipo Miniflare documentado com método e limites (§4.3); não é medição de produção.
- Radar: 40 slugs, Actions ok, fora do AE e do mutex do Worker (§6.4).

**Amostra insuficiente** (há medida, janela curta demais para fechar parâmetro)

- `provider_http_attempt` desde ≈ 30/10/2026 (~3 dias úteis de telemetria).
- Dia civil completo de D1 **após** `#622`/`#624`.
- Extrapolação de reads/writes da coordenação a partir só do Miniflare.
- Picos por minuto de HTTP (endpoint `/metrics/ops` não expõe).

**Lacunas ainda não obtíveis sem outro acesso ou decisão**

- Fatura / inscrição Cloudflare (billing API 403; browser CDP falhou).
- Plano FD contratado e cabeçalhos reais de cota (sem chamada ao provedor; browser FD não aberto).
- Divergência Standard 30/min (policies) × 60/min (pricing / fontes secundárias).
- Janela fixa vs deslizante e consumo de cota em respostas 429 no FD.
- Termos ESPN / autorização de uso no Brasil (ticket 04).
- Contenção D1 multi-isolate sob a fila nova.
- Forma da carga em dia cheio de jogos (fins de semana longos).

Amostra mínima sugerida antes de cravar parâmetros de orçamento: 2 a 4 semanas com rodadas de meio de semana e fins de semana, lendo `provider_http_attempt` (com `AVG(_sample_interval)`) e `football_api_error` sem gerar carga artificial; mais ≥1 dia civil UTC de GraphQL D1 pós-`#622`.

---

## 10. Fontes

Cloudflare (lidas 02/11/2026):

- Workers limits: <https://developers.cloudflare.com/workers/platform/limits/> (atualizada 29/10/2026; CPU exclui espera de rede)
- Workers pricing (`usage_model` Standard disponível no plano Workers Paid; não prova o inverso): <https://developers.cloudflare.com/workers/platform/pricing/>
- D1 limits: <https://developers.cloudflare.com/d1/platform/limits/> (30/10/2026)
- D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/> (30/10/2026)
- Queues pricing: <https://developers.cloudflare.com/queues/platform/pricing/> (30/10/2026; Free retention 24 h)
- Queues limits: <https://developers.cloudflare.com/queues/platform/limits/> (30/10/2026)
- Durable Objects pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing/> (18/10/2026)
- Analytics Engine sampling: <https://developers.cloudflare.com/analytics/analytics-engine/sampling/>
- Analytics Engine SQL API (`_sample_interval`): <https://developers.cloudflare.com/analytics/analytics-engine/sql-api/>

football-data.org:

- Policies (throttling): <https://docs.football-data.org/general/v4/policies.html> (Free 10/min; Standard 30/min; superiores 60/min)
- Lookup tables (cabeçalhos `X-RequestsAvailable`, `X-RequestCounter-Reset`): <https://docs.football-data.org/general/v4/lookup_tables.html>
- Pricing UI: <https://www.football-data.org/pricing> (renderização parcial; divergência 30×60 com a policy)

Medições internas (acesso autenticado existente; agregados finos só no scratch local):

- `wrangler d1 execute palpitae --remote` (SELECT)
- `wrangler d1 info palpitae` (24 h móvel)
- GraphQL `d1AnalyticsAdaptiveGroups` (dias de calendário UTC e `datetimeHour`)
- SQL API do Analytics Engine (`AVG(_sample_interval)`, `provider_http_attempt`, `football_api_error`, `poller_run`)
- Workers script/account settings (`usage_model`)
- Protótipo Miniflare local (fila + razão; `meta.rows_read` / `meta.rows_written`) — não é D1 de produção
- `GET /metrics/ops` e `/metrics/overview` (coleta da tarde; revisão noturna usou SQL API direta)

Código: `api/wrangler.toml`, `api/src/index.ts`, `api/src/matches/{sync,poller,fixtureDiscovery,espnFallback,espnSync,footballDataQuota,espnQuota,matchPollingWindow,router}.ts`, `api/src/providers/espn.ts`, `api/src/observability/{providerHttp,metricsRouter}.ts`, `api/src/security/limits.ts`, `api/src/radar/espnRadar.ts`, `.github/workflows/radar-sync.yml`.
