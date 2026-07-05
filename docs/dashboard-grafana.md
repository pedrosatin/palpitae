# Dashboard de métricas — Opção A: Grafana Cloud

Guia pra plugar o Grafana Cloud (free tier) direto na SQL API do Analytics Engine.
É a alternativa externa ao dashboard nativo (`/admin/metricas`, ver
`docs/observability.md`). Objetivo: comparar as duas e escolher uma.

## O que o Grafana cobre (e o que não)

- ✅ **Analytics Engine** (hot path, ~3 meses): via plugin Infinity → SQL API.
- ❌ **R2** (cold path): não tem datasource nativo. Pra série histórica além de
  3 meses seria preciso expor um endpoint público/tokenizado no Worker — não
  vale o esforço agora; o dashboard nativo já lista o arquivo R2.

## Passo 1 — Token da SQL API

O mesmo tipo de token que o cold path já usa (`AE_SQL_TOKEN`), mas **crie um
token separado** pro Grafana (revogável de forma independente):

1. Dash Cloudflare → My Profile → API Tokens → Create Token → Custom.
2. Permissão: **Account → Account Analytics → Read**. Só isso.
3. Guarde o token e o **Account ID** (dash → Workers & Pages → sidebar direita).

## Passo 2 — Grafana Cloud + plugin Infinity

1. Conta free em <https://grafana.com> (1 stack, 3 usuários — suficiente).
2. Administration → Plugins → instale **Infinity** (yesoreyeram-infinity-datasource).
3. Connections → Data sources → Add → Infinity:
   - **Auth**: Bearer Token → cole o token do passo 1.
   - **Allowed hosts**: `https://api.cloudflare.com`.
   - Salve.

## Passo 3 — Painéis

Todo painel usa o mesmo esqueleto Infinity:

- **Type**: JSON · **Parser**: Backend · **Source**: URL
- **Method**: POST
- **URL**: `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql`
- **Body** (Raw): a query SQL do painel
- **Rows/Root**: `data`

A SQL API devolve `{ "data": [...], "meta": [...] }`; o root selector `data`
entrega as linhas prontas pro Grafana.

**Sampling (regra de ouro):** sempre `SUM(_sample_interval)`, nunca `COUNT(*)`
— sob sampling cada linha representa N linhas reais (ver `docs/observability.md`).

### Painel 1 — Eventos por dia (time series, stacked)

```sql
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
       blob1 AS event_type,
       SUM(_sample_interval) AS count
FROM palpitae_events
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, event_type
ORDER BY day ASC
```

Visualização: Time series · transform "Partition by values" em `event_type`
(uma série por tipo) · stacking Normal.

### Painel 2 — Totais por evento (bar gauge ou table)

```sql
SELECT blob1 AS event_type, SUM(_sample_interval) AS count
FROM palpitae_events
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY event_type
ORDER BY count DESC
```

### Painel 3 — Saúde do poller (stat + table)

```sql
SELECT blob2 AS status,
       SUM(_sample_interval) AS runs,
       AVG(double4) AS avg_duration_ms,
       MAX(double4) AS max_duration_ms
FROM palpitae_events
WHERE blob1 = 'poller_run'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY status
```

Stat de `runs` com threshold: `status = 'error'` > 0 ⇒ vermelho.

### Painel 4 — Usuários distintos que palpitaram (stat)

```sql
SELECT COUNT(DISTINCT blob4) AS users
FROM palpitae_events
WHERE blob1 = 'prediction_saved'
  AND timestamp > NOW() - INTERVAL '30' DAY
```

(`blob4` = `user_hash` no esquema posicional de `prediction_saved` —
a tabela em `docs/observability.md` é a fonte de verdade das posições.
`COUNT(DISTINCT ...)` sobre hash estável funciona mesmo sob sampling,
mas vira aproximação se houver amostragem pesada.)

### Bônus — alertas

Grafana free inclui alerting: ex. alerta se `poller_run` com `status='error'`
passar de N na última hora, ou se `login_failure` disparar. É o principal
diferencial sobre o dashboard nativo.

## Variável de período (opcional)

Dashboard settings → Variables → `period` (custom: `7,30,90`) e use
`INTERVAL '$period' DAY` nas queries.

## Comparação com a Opção B (dashboard nativo)

| | Grafana Cloud | `/admin/metricas` (nativo) |
|---|---|---|
| Setup | conta + token + plugin | já deployado |
| Gráficos | ricos, zoom, anotações | SVG simples |
| Alertas | ✅ grátis | ❌ (exigiria cron + e-mail) |
| R2 (cold path) | ❌ | ✅ lista arquivos |
| Dependência externa | Grafana Cloud + token de conta lá fora | zero |
| Custo | free tier (limites folgados p/ 1 pessoa) | zero |
