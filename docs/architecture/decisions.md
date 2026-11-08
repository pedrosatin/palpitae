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

Casamento jogo↔evento: nomes dos times normalizados (NFD, sem diacritics, lowercase, sem pontuação — o padrão do `matchKey` do radar), com conter/contido nos dois sentidos (football-data usa 'Liverpool FC', a ESPN 'Liverpool'), exigido em mandante E visitante, mais kickoff a até ±150 min. Toda dúvida é **fail-closed**: 0 ou >1 candidatos, estado diferente de 'post', placar não-numérico → pula o jogo. Errar por não pontuar é recuperável (o primário volta e o sync diário/ADR-013 cobre remarcações); pontuar errado não é.

Os clubes do Brasileirão são gravados com o nome popular, escolhido pelo `external_id` da football-data em `api/src/matches/clubNames.ts`. O nome popular segue o da ESPN e casa pelo mesmo critério.

Mapeamento de competições em `FOOTBALL_DATA_TO_ESPN` (código football-data → slug ESPN), conferido ao vivo em `api.football-data.org/v4/competitions`: Europa League é **`EL`** → `uefa.europa` (o código `ECL` dos rascunhos não existe; Conference League é `UCL`, TIER_FOUR, fora do free tier e sem uso no produto). `EC` (Eurocopa, TIER_ONE) entrou como `uefa.euro`. Código sem mapeamento → log info e fallback não se aplica — não é erro.

Dois detalhes da ESPN validados ao vivo que moldaram a implementação:

- O parâmetro de data é **`dates=YYYYMMDD` (plural)**. O singular `date=` é silenciosamente ignorado e devolve a rodada corrente — todos os eventos em 'pre', ou seja, um fallback que nunca atualiza nada.
- O scoreboard agrupa eventos por **dia norte-americano**: São Paulo×Cruzeiro `2026-10-08T00:30Z` aparece em `dates=20261007`. Por isso buscamos o dia UTC de cada jogo E o dia anterior (2 fetches por data distinta — cobre qualquer fronteira de fuso fixa).

### Atualização — 2026-10-26

O fallback também roda após um sync bem-sucedido que deixou jogos sem resultado. Consulta somente partidas ainda não finalizadas, de 115 minutos até 24 horas após o início, e exclui adiados fora da janela ativa de 200 minutos. Placares alterados limpam `scored_at` para refazer a pontuação. O sync primário preserva a linha de um jogo finalizado quando recebe um estado não final; correções de resultado final continuam permitidas.

### Consequences

- **Roda dentro do Worker pelo cliente ESPN compartilhado.** A consulta ao D1 evita requests para competições sem pendentes. As chamadas HTTP compartilham timeout, pacing anti-403 e retry limitado com os demais consumidores da ESPN; a janela de resgate pode consultar até três datas por competição.
- Falha do fallback NUNCA quebra o poller: try/catch no ponto de chamada e por competição dentro do módulo. O próximo run volta a tentar pelo caminho primário.
- **Observabilidade**: um evento `match_results_fallback` por competição (`blobs: [compId]`, `doubles: [atualizados, pulados]`) no Analytics Engine, além do `football_api_error` já emitido na falha do primário. O `poller_run` segue com status `error` quando o primário falhou — o fallback é melhor-esforço, não apaga o incidente.
- **Pênaltis ficam fora do escopo**: o fallback grava só placar e status; `penalty_winner` e gols de pênaltis permanecem como estavam. Quando o primário volta, o upsert do sync preenche os campos e zera `scored_at` (mecanismo já existente), disparando re-score com o bônus de pênaltis. Custo transitório: grupos de mata-mata podem ver os pontos do bônus chegarem depois.
- O fallback não conhece `postponed` — irrelevante na prática: jogo adiado não acontece no horário original, o evento ESPN correspondente não termina ('post') dentro da janela, e a tolerância de ±150 min rejeita remarcações para outro dia. O ADR-013 continua sendo a via de resgate desses jogos.
- Nomes de seleções são traduzidos no sync primário ('Brazil' → 'Brasil', `TEAM_TRANSLATIONS` em `sync.ts`) e a ESPN usa o nome em inglês ('Brazil') — o casamento por conter/contido não casa 'Brasil'×'Brazil'. Hoje isso só afetaria Copa do Mundo/Eurocopa; aceitável como limitação conhecida (fail-closed: o jogo só fica sem placar até o primário voltar).
- A ESPN não-oficial não tem SLA nem schema versionado; o código trata payload ausente/inesperado como não-casamento (fail-closed), não como erro.

## ADR-017: Controle de acesso e persistência de limites

### Contexto

Revelar palpites após o primeiro envio permite copiar os demais e editar antes
do início da partida. Remover apenas a participação permite reentrar com um
convite salvo. Sessões JWT copiadas também permanecem válidas após o logout.

### Decisão

Grupos ocultos revelam palpites alheios somente após o bloqueio da partida. O
próprio palpite segue editável até esse bloqueio. A remoção feita pelo dono revoga
a participação e a reentrada no grupo; a saída voluntária preserva a reentrada.
Grupos excluídos deixam de autorizar consultas e gravações.

O D1 guarda os bloqueios de membros, os hashes das sessões revogadas até sua
expiração e os contadores atômicos de requisições. Requisições com sessão válida
contam por usuário; as anônimas, por IP do visitante. Atrás do proxy do Pages, o
IP chega num header autenticado por `PROXY_SHARED_SECRET`, porque o
`CF-Connecting-IP` de um subrequest de Worker é o endereço de saída da Cloudflare.
Os crons limpam os contadores e revogações expirados. Leituras de partidas
consultam os dados locais; cron e sync administrativo atualizam os provedores
externos, e o poller resgata jogos sem resultado por até 24 horas.

### Consequências

A migração precisa preceder a publicação do Worker. Cada requisição fora de
`/health` faz uma escrita no D1 (contador) e, com cookie de sessão, uma leitura
em `revoked_sessions`. Leituras seguem sem contador se o D1 falhar; escritas e
OAuth respondem 503. Os limites e a política de acesso estão em
[Controle de acesso e limites da API](../security.md).

## ADR-018: ESPN como provider primário nas competições fora do free tier

**Status:** Accepted
**Date:** 2026-10-17

### Context

O produto jogável tem só Copa do Mundo 2026 e Brasileirão Série A 2026. As competições de maior interesse BR fora do produto — Libertadores, Copa do Brasil e Sul-Americana — estão no football-data.org apenas em planos pagos, e a regra do lote é usar só fontes grátis, sem upgrade de plano. A ESPN cobre as três de graça, mas a ADR-016 proíbe a ESPN de criar jogos: lá ela é só fallback de resultados, e a descoberta é exclusiva do football-data.org.

### Decision

Modelo multi-provider por competição, mantendo custo zero:

- football-data.org (free tier) segue primário onde cobre, ex.: Champions (`CL`) e Premier League (`PL`); nelas a ESPN continua só fallback de placar.
- A ESPN vira provider primário — descobre e cria times e jogos — só nas competições fora do free tier que entrarem no produto, a começar por Libertadores, Copa do Brasil e Sul-Americana.
- Campeonato sem fonte grátis validada não entra. Antes do cadastro, um spike precisa confirmar jogos, datas, fases, placares, vencedor de pênaltis e vínculo ida/volta no slug ESPN.
- Esta ADR supersede a ADR-016 apenas na frase "a descoberta de jogos permanece exclusiva do football-data.org". Todo o resto da ADR-016 (fallback fail-closed, casamento de jogos, observabilidade) segue válido para competições do football-data.

### Consequences

- A ESPN é API não oficial, sem SLA: competição ESPN-primária nasce com risco de mudança de formato, mitigado pelo spike de entrada e por testes de contrato com payload mockado.
- O discovery diário e o poller, hoje restritos a `provider='football-data'`, passam a incluir competições `provider='espn'`. O fallback ESPN precisa ignorar competições em que a ESPN já é primária, para não duplicar jogos.
- Estaduais seguem fora do roadmap mesmo com ESPN disponível: janela curta e decisão de produto, não limitação de fonte.
- Em 2026-10-19 o spike em `docs/architecture/spike-espn-serie-b.md` aprovou `bra.2` (fixture e teste de contrato). A liga pode entrar como ESPN-primária `type=league` no ticket 06 do lote 2, sem reabrir o spike de copas. No football-data, `BSB` é TIER_THREE. O sync já mapeia `2026-brasileiro-serie-b` para `REGULAR_SEASON` (#546). Sem `week`/`matchday` no scoreboard, a rodada do piloto fica `REGULAR_SEASON`.

## ADR-019: Rodada padrão ignora rodada antiga com jogo remarcado

**Status:** Accepted
**Date:** 2026-11-07

### Context

A rodada padrão (`default_round`) era a rodada com o menor `MAX(start_time)` ainda no futuro. A ADR-013 contava com isso para os adiados: o adiado guarda o horário original, a rodada sai do default, e "a rodada 21 só volta a ser default quando aqueles jogos forem de fato o próximo compromisso do calendário".

Remarcado é outro caso. Em 07/11/2026 a rodada 21 do Brasileirão tinha 9 jogos encerrados entre julho e outubro e Chapecoense × Vasco remarcado para 14/11, com `postponed = 0`. A rodada 35, toda futura, termina em 20/11. Como 14/11 vem antes de 20/11, o grupo abria na 21, uma tela quase toda encerrada, enquanto a ação do usuário era a 35. A mesma consulta estava copiada em `GET /matches`, `GET /predictions/user` e na contagem de pendentes da home.

### Decision

Uma rodada candidata (com jogo futuro) **fica para trás** quando a maioria dos jogos dela começou há mais de 7 dias (`start_time <= now - 7 dias`, só pelo horário). As candidatas são ordenadas por `ficou para trás` e depois por `MAX(start_time)`; a primeira é a rodada padrão. Se todas ficaram para trás, a ordem é só `MAX(start_time)`, como antes. No empate de `MAX(start_time)` vence a rodada que começou depois, e `round` fecha o desempate. A dica da aba Palpitar procura rodadas antes da aberta, então aponta a outra. Sem candidata, o default continua sendo a rodada do último jogo.

A definição está em `api/src/matches/defaultRound.ts`, compartilhada pelas três consultas. O front repete só o "ficou para trás" em `web/src/lib/rounds.ts`, para a dica, e recebe a rodada padrão pronta no `default_round`.

Os casos que mantêm o comportamento anterior:

- Rodada em andamento: tem jogos de ontem e de amanhã, nenhuma maioria antiga.
- Mata-mata de ida e volta numa rodada só, com uma semana de intervalo: a ida é metade dos jogos, e metade não é maioria.
- Fim de temporada sem jogo futuro: nenhuma candidata, cai no último jogo.
- Adiado sem data nova: guarda o horário passado (ADR-013), a rodada nem é candidata.

O travamento continua o da ADR-004 (`lockedSql`): a regra só escolhe qual rodada abre, não muda quem pode palpitar.

### Consequences

- O jogo remarcado aparece na aba Palpitar pela dica da ADR-013, agora para adiados e remarcados ("Rodada 21 tem 1 jogo remarcado. O palpite segue aberto. Ver rodada"), e o seletor marca a rodada ("Rodada 21 · 1 remarcado"). A rodada padrão nunca ganha esse marcador, mesmo quando também ficou para trás.
- A contagem de pendentes da home soma os jogos abertos da rodada padrão e os jogos futuros abertos das outras rodadas que ficaram para trás: o remarcado tem prazo e a home é o único lugar que avisa dele antes de o usuário abrir o grupo. Adiado sem data nova de rodada antiga continua fora da contagem. A contagem sai de uma varredura só do índice coberto da competição, que numera as candidatas e já traz a rodada padrão e as que ficaram para trás. Os jogos de cada uma vêm de `idx_matches_comp_round_start` com a rodada já resolvida. O `GET /groups` continua lendo o índice da competição uma vez por grupo.
- Risco aceito: uma fase longa numa rodada só (`GROUP_STAGE`, `TACA_GUANABARA`, `REGULAR_SEASON`) também fica para trás depois de algumas semanas. Enquanto ela for a única candidata, a ordem só por `MAX(start_time)` a mantém como padrão; se outra fase já tiver jogos cadastrados enquanto ela ainda corre, o default pula para a outra. Hoje o sync só grava jogo de mata-mata com os times definidos. Em competição com sorteio entre fases, a seguinte só aparece depois que a anterior acaba. Em chave fixa, um jogo pode aparecer antes.
- Risco aceito: uma rodada dividida, como 7 jogos no sábado e 3 remarcados para 11 dias depois, perde o default 7 dias depois do sábado. Os remarcados vão para a dica mesmo sendo o próximo jogo do calendário.
- Substitui a frase da ADR-013 (removida deste arquivo em #467; o texto está no histórico do Git) sobre a rodada remarcada voltar a ser default quando seus jogos forem o próximo compromisso.

## ADR-020: Lembrete diário por jogo sem palpite

**Status:** Accepted
**Date:** 2026-11-08

### Context

O e-mail de lembrete saía às 07h do primeiro dia da rodada, só para quem não tinha nenhum palpite na rodada. A rodada 35 do Brasileirão tem 1 jogo em 14/11 e 9 em 18 e 19/11. Quem palpitasse o primeiro não recebia aviso dos outros 9. Um cron por dia e o filtro do primeiro dia da rodada eram a proteção contra repetição.

### Decision

O cron das 07h BRT agora envia, a cada usuário, um e-mail com os jogos de hoje ainda abertos e sem palpite, agrupados por grupo e rodada. Jogo adiado (`postponed = 1`) não entra, porque não tem data. Jogo remarcado (`postponed = 0` e horário novo) entra no dia novo, mesmo em rodada que ficou para trás (ADR-019), e o link usa a rodada dele. O link leva `?rodada=` e abre a aba Palpitar nessa rodada.

O limite de um e-mail por usuário por dia fica no banco, na tabela `email_reminder_sends` (`PRIMARY KEY (user_id, reminder_date)`, migration 0036). O cron reserva todos os destinatários em uma gravação antes do primeiro envio e só envia para quem a reserva devolveu. Falha de envio devolve a reserva. Reenvio dentro de `sendWithRetry` e reexecução no mesmo dia usam o mesmo `Idempotency-Key` do Resend.

A reserva é uma gravação só por execução porque cada consulta ao D1 conta no limite de subrequests do Worker junto com os envios ao Resend.

### Consequences

- Risco aceito: uma invocação interrompida entre a reserva e o envio deixa os restantes sem e-mail naquele dia. Perder um aviso é preferível a repetir o e-mail.
- Quem nunca palpita recebe um e-mail por dia com jogo, em vez de um por rodada. O volume sobe e consome a cota do Resend. Cota esgotada encerra a fila e registra `email_reminder_failed` com `reason = quota_exceeded`.
- `email_reminder_sent` deixa de ter campeonato e rodada, porque um e-mail reúne vários. O evento traz o dia e o número de jogos listados.
