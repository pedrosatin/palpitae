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

### R2 — cold path (retenção ILIMITADA)
Um **cron diário** consulta a SQL API pelos eventos do dia anterior (UTC) e grava **um**
NDJSON em `events/YYYY/MM/DD.ndjson`. R2 é grátis (10 GB, egress zero, free tier não expira)
e S3-compatible. Um arquivo/dia ⇒ ~365 escritas/ano, irrisório. O Analytics Engine é o
**staging** (query rápida, ~3 meses); o cron "congela" tudo em R2 pra sempre. Reaproveita o
cron que já existe — sem Queues (pago) nem Durable Object.

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
  `football_api_error`.
- Negócio: `prediction_saved` (single/bulk/import), `group_created`, `group_joined`,
  `group_renamed`, `member_removed`, `login_success`, `login_failure`, `oauth_error`,
  `matches_cache` (hit/miss).

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

## LGPD / privacidade

Log server-side de dado operacional legítimo não exige banner de consentimento (diferente do
GA, que é marketing/cliente). **Nunca** jogar PII crua — nem o `user_id` cru — no Analytics
Engine/R2: pseudonimizar com `hashUserId()` (SHA-256 truncado). Eventos servem pra
contar/agregar, não pra reidentificar.

## Onde está o código

- `api/src/observability/events.ts` — `logEvent`, `EventType`, `hashUserId`.
- `api/src/observability/export.ts` — `exportEventsToR2` / `dayBounds` (cold path).
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
