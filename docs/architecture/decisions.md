## ADR-015: Radar Provider — ESPN em lugar da API-Football


**Status:** Accepted
**Date:** 2026-10-05

### Context

A conta da API-Football foi **suspensa em 04/09/2026**, sem causa informada. O uso era exatamente o projetado na ADR-014: 2 requisições/dia das 100 da quota (catálogo + jogos do dia), nada além. Hipótese — nunca confirmada pelo suporte: os IPs rotativos dos runners do GitHub Actions, compartilhados com outros clientes da mesma API, podem ter tocado algum bloqueio de abuso. Não havia perspectiva de reação e decidimos não pagar plano nem esperar suporte: o radar é inteligência de produto, não componente do produto.

O que o substituto precisava manter: cobertura das competições que o provider do produto não enxerga (Libertadores, Sul-Americana, Copa do Brasil, estaduais), temporada corrente, jogos do dia, custo zero. Testado ao vivo em 05/10/2026: a **API pública da ESPN** (`site.api.espn.com`) responde 200 sem autenticação, sem quota conhecida e estável há anos — não é uma API documentada/oficial, é a que alimenta o próprio site da ESPN.

### Decision

Trocar a **fonte de oferta** do radar para a ESPN (`api/src/providers/espn.ts` + `api/src/radar/espnRadar.ts`). Demanda (Wikipedia Pageviews), demanda interna (D1), snapshot fail-closed e o modelo "script gera SQL + wrangler aplica" da ADR-014 ficam como estão.

- O padrão de coleta muda de **"2 chamadas que trazem o mundo"** (`/leagues?current=true` + `/fixtures?date=`) para **"~35 chamadas de slugs curados"**: uma de scoreboard por competição do recorte, lista estática (`ESPN_LEAGUES`), concorrência limitada. A ESPN não tem catálogo utilizável em runtime.
- **A temporada vem na própria resposta** do scoreboard (`leagues[0].season`): não existe mais chamada de catálogo. Liga sem `season`, ou com season fora da janela — a ESPN deixa a última edição no payload, ex. Euro 2024 e Copa América 2024 em pleno 2026 —, é pulada como "não corrente" (o equivalente do `current=true` antigo).
- **`matches_today` é contado filtrando os `events` pelo campo `date`**: o parâmetro `date` do scoreboard NÃO filtra estritamente — para uma data sem jogos devolve a rodada vizinha e, fora de temporada, os últimos jogos. `events.length` sozinho contaria jogos que não são do dia (descoberto comparando payloads reais).
- Nomes e países das ligas são **escolhidos na curadoria**, não copiados da ESPN (que chama bra.1 de "Brazilian Serie A" e esp.1 de "Spanish La Liga"): o casamento com os artigos da Wikipédia continua por `(país, nome)` normalizado.
- O refresh da lista curada é **manual/mensal**, conferindo o catálogo completo de slugs (~219, espelhado em `api/src/radar/__fixtures__/espn-catalog.json`):

```bash
for p in $(seq 1 9); do
  curl -s "https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=2000&page=$p" |
    python3 -c 'import json,sys; [print(r["$ref"].rsplit("/",1)[1].split("?")[0]) for r in json.load(sys.stdin).get("items",[])]'
done | sort -u
```

- O sync purga as linhas do provedor antigo no início de todo snapshot (idempotente): `DELETE FROM competition_radar WHERE provider = 'api-football'` + `DELETE FROM competition_radar_daily WHERE radar_id LIKE 'api-football:%'`.

### Consequences

- **Lacunas aceitas** — não existem na ESPN: Série C, Campeonato Baiano, Pernambucano, Paranaense, Copa do Nordeste e Brasileirão Feminino. As entradas de artigo dessas competições em `articles.ts` ficam sem sinal de oferta (e sem pageviews, que só rodam para o que está no snapshot) até a ESPN cobrir ou outro provider entrar.
- **Risco de API não-oficial** (sem SLA, pode mudar sem aviso) mitigado pelo desenho fail-closed: coleta que falha ou volta vazia preserva o snapshot do dia anterior e deixa o workflow vermelho; a dashboard avisa quando o snapshot passa de 30h.
- **Sem chave → sem secret**: `API_FOOTBALL_KEY` sai do workflow e pode ser removido do repositório no GitHub. A coleta continua no Actions **por escolha de arquitetura** (SQL + wrangler, credenciais separadas — ver ADR-014), não por rate limit: a ESPN não tem chave nem política por IP.
- Custo por execução: ~35 chamadas à ESPN + ~1 chamada à Wikimedia por competição mapeada (~26). Nenhuma quota conhecida dos dois lados.
- Falha parcial de slugs é tolerada (o snapshot segue com os que responderam, os falhos vão no log); todos em erro aborta a coleta.
- A ADR-014 permanece válida exceto na fonte de oferta e na consequência do rate limit por IP, que esta supersede.

---

## ADR-016: Results Failover — ESPN como reserva do football-data.org


**Status:** Accepted
**Date:** 2026-10-05

### Context

O poller de resultados (ADR-007) só pontua um jogo depois que o `syncFixtures` da football-data.org grava o placar no D1. Se a API cai (429/5xx/outage) exatamente na janela de 115–200 min após o kickoff, o jogo fica sem placar até o provedor voltar — e a janela do poller passa uma vez só: quando o primário volta, o jogo saiu da janela e nunca mais é pontuado pelo caminho normal.

O plano B testado ao vivo em 05/10/2026 é o scoreboard não-oficial da ESPN: `GET https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard` responde 200 sem autenticação e sem quota conhecida. A conta da API-Football (usada só pelo radar, ADR-014) foi suspensa sem causa em 04/set — o requisito do operador é ter plano B gratuito para o produto também.

### Decision

**O fallback é só de RESULTADOS.** Quando o `syncFixtures` de uma competição falha no poller, `api/src/matches/espnFallback.ts` (`scoreWindowFromEspn`) consulta os jogos daquela competição na mesma janela ativa do poller (`status != 'finished'`, start+115..200 min), busca o scoreboard da ESPN e, para cada jogo interno que casa com um evento encerrado (`status.type.state = 'post'`), grava `home_score`, `away_score` e `status = 'finished'` com `UPDATE ... WHERE id = ? AND status != 'finished'`. Competição onde o fallback atualizou ≥1 jogo entra no `syncedComps` e segue para o `scoreUnprocessedMatches` como se o sync tivesse funcionado. `scored_at` fica NULL de propósito — a pontuação acontece na sequência, pelo mecanismo existente.

**A descoberta de jogos permanece exclusiva do football-data.org** (ADR-010). O fallback NUNCA insere jogos, times ou competições — só `UPDATE` em linhas existentes. Sem essa restrição, um provedor de reserva com ids e nomes diferentes criaria entidades duplicadas (`UNIQUE (external_id, provider)` não protegeria contra ids de outro provider) e jogos "gêmeos" quebrariam palpites e grupos.

Casamento jogo↔evento: nomes dos times normalizados (NFD, sem diacritics, lowercase, sem pontuação — o padrão do `matchKey` do radar), com conter/contido nos dois sentidos (football-data usa 'CR Flamengo', a ESPN 'Flamengo'), exigido em mandante E visitante, mais kickoff a até ±150 min. Toda dúvida é **fail-closed**: 0 ou >1 candidatos, estado diferente de 'post', placar não-numérico → pula o jogo. Errar por não pontuar é recuperável (o primário volta e o sync diário/ADR-013 cobre remarcações); pontuar errado não é.

Mapeamento de competições em `FOOTBALL_DATA_TO_ESPN` (código football-data → slug ESPN), conferido ao vivo em `api.football-data.org/v4/competitions`: Europa League é **`EL`** → `uefa.europa` (o código `ECL` dos rascunhos não existe; Conference League é `UCL`, TIER_FOUR, fora do free tier e sem uso no produto). `EC` (Eurocopa, TIER_ONE) entrou como `uefa.euro`. Código sem mapeamento → log info e fallback não se aplica — não é erro.

Dois detalhes da ESPN validados ao vivo que moldaram a implementação:

- O parâmetro de data é **`dates=YYYYMMDD` (plural)**. O singular `date=` é silenciosamente ignorado e devolve a rodada corrente — todos os eventos em 'pre', ou seja, um fallback que nunca atualiza nada.
- O scoreboard agrupa eventos por **dia norte-americano**: São Paulo×Cruzeiro `2026-10-08T00:30Z` aparece em `dates=20261007`. Por isso buscamos o dia UTC de cada jogo E o dia anterior (2 fetches por data distinta — cobre qualquer fronteira de fuso fixa).

### Consequences

- **Roda dentro do Worker, sem rate limit adicional.** A ESPN não filtra por IP de origem (a lição da API-Football no ADR-014 não se aplica), e o volume é ínfimo por construção: o fallback só roda quando o primário falhou, só para competições com jogos na janela de 85 min, com ~2 fetches por competição. De graça e sem chave — não há o que gerenciar.
- Falha do fallback NUNCA quebra o poller: try/catch no ponto de chamada e por competição dentro do módulo. O próximo run volta a tentar pelo caminho primário.
- **Observabilidade**: um evento `match_results_fallback` por competição (`blobs: [compId]`, `doubles: [atualizados, pulados]`) no Analytics Engine, além do `football_api_error` já emitido na falha do primário. O `poller_run` segue com status `error` quando o primário falhou — o fallback é melhor-esforço, não apaga o incidente.
- **Pênaltis ficam fora do escopo**: o fallback grava só placar e status; `penalty_winner` e gols de pênaltis permanecem como estavam. Quando o primário volta, o upsert do sync preenche os campos e zera `scored_at` (mecanismo já existente), disparando re-score com o bônus de pênaltis. Custo transitório: grupos de mata-mata podem ver os pontos do bônus chegarem depois.
- O fallback não conhece `postponed` — irrelevante na prática: jogo adiado não acontece no horário original, o evento ESPN correspondente não termina ('post') dentro da janela, e a tolerância de ±150 min rejeita remarcações para outro dia. O ADR-013 continua sendo a via de resgate desses jogos.
- Nomes de seleções são traduzidos no sync primário ('Brazil' → 'Brasil', `TEAM_TRANSLATIONS` em `sync.ts`) e a ESPN usa o nome em inglês ('Brazil') — o casamento por conter/contido não casa 'Brasil'×'Brazil'. Hoje isso só afetaria Copa do Mundo/Eurocopa; aceitável como limitação conhecida (fail-closed: o jogo só fica sem placar até o primário voltar).
- A ESPN não-oficial não tem SLA nem schema versionado; o código trata payload ausente/inesperado como não-casamento (fail-closed), não como erro.
