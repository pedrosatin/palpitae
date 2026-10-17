# Spike ESPN como fonte de confrontos para Libertadores, Sul-Americana e Copa do Brasil

## Objetivo

Este documento registra o resultado do spike que avaliou a API pública da ESPN como fonte de confrontos para três competições fora do lote atual do Palpitae. As três são CONMEBOL Libertadores (`conmebol.libertadores`), Copa do Brasil (`bra.copa_do_brazil`) e CONMEBOL Sul-Americana (`conmebol.sudamericana`). A ADR-016 limita a ESPN ao papel de fallback de resultados e proíbe a criação de confrontos a partir dela. A ADR-018, aceita em conversa e ainda fora desta branch, libera a ESPN como provider primário dessas três competições se este spike aprovar os dados. Cada competição recebe um veredito próprio neste relatório. Competição reprovada sai do lote e o projeto não contrata fonte paga para substituí-la.

## Método

A coleta consultou a API ao vivo em 17 de outubro de 2026, sem autenticação, pelo endpoint `GET https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard`. As amostras usam jogos encerrados da temporada 2026 com placar conhecido, porque jogo futuro só prova a existência do confronto e não prova placar, fase nem disputa de pênaltis. Recortes das respostas reais estão salvos em `api/src/providers/__fixtures__/`, um arquivo por slug, com os campos pesados removidos (`details`, `odds`, `broadcasts`, `links`, `statistics`). Cada fixture junta eventos de dias diferentes na mesma estrutura de scoreboard e soma 6 eventos por competição. O teste `api/src/providers/espnFixtures.test.ts` fixa os campos que sustentam cada veredito. Este spike não altera comportamento de produção: nenhum provider novo entra no sync, nenhuma competição nova nasce no banco e o poller segue como está.

## Comportamento do endpoint

A consulta ao vivo separou o parâmetro que funciona do parâmetro que a ESPN ignora. `?dates=20260407` devolveu os 6 eventos do dia pedido na Libertadores, todos encerrados. `?date=20260407` devolveu 1 evento de 16 de outubro, a rodada corrente das semifinais, e portanto a ESPN ignora o parâmetro no singular. Intervalo no plural também falhou. `?dates=20260407-20260408` e `?dates=20260401-20260430` responderam HTTP 400. A busca por data é de um dia por chamada.

O agrupamento do scoreboard segue o dia norte-americano. A chamada `?dates=20261015` devolveu o jogo Estudiantes de La Plata x Flamengo com `date` em `2026-10-16T00:30Z`. Quem consome o endpoint filtra os eventos pelo campo `date` de cada evento, regra que a ADR-015 já registra para o radar. Sem parâmetro de data, o endpoint devolve a rodada corrente e mistura jogos encerrados com jogos futuros: a resposta da Copa do Brasil trouxe as semifinais de 1 de novembro em estado `pre`, com data, times, `leg` e `series` já montados. O mesmo endpoint serve para descobrir confrontos futuros e para ler resultados, e o estado do evento separa os dois usos.

O helper `espnScoreboardUrl` em `api/src/providers/espn.ts` monta a URL com `date=` no singular, o parâmetro ignorado. O radar tolera o erro porque filtra os eventos pelo campo `date` ao contar os jogos do dia, e o fallback de resultados em `api/src/matches/espnFallback.ts` já usa `dates=` no plural. A correção do helper fica para o ticket que transformar a ESPN em provider primário. Este spike registra o achado e mantém o código de produção intacto.

## Campos que sustentam os vereditos

A tabela abaixo resume onde cada requisito do ticket aparece no payload. Todos os campos listados existem nas amostras salvas e o teste de contrato confere cada um.

| Requisito | Campo no payload | Comportamento observado |
| --- | --- | --- |
| Data e hora do jogo | `events[].date` | ISO 8601 em UTC, presente em jogo futuro e encerrado |
| Mandante e visitante | `competitions[0].competitors[]` com `homeAway` | Dois competidores por evento, um `home` e um `away`, com `team.id` numérico estável e `team.displayName` |
| Placar | `competitors[].score` | String numérica em jogo encerrado; `"0"` em jogo agendado |
| Jogo encerrado | `competitions[0].status.type` | `state` igual a `post`, `name` igual a `STATUS_FULL_TIME` ou `STATUS_FINAL_PEN`, `detail` igual a `FT` ou `FT-Pens` |
| Fase | `events[].season.slug` e `competitions[0].altGameNote` | Slug por evento, como `group-stage` e `round-of-16`; `altGameNote` repete a fase em texto, como "CONMEBOL Libertadores, Group C" |
| Grupo | `competitions[0].group` | Objeto com `groupId` e `name` ("Group C") em jogo de grupo; ausente no mata-mata |
| Perna do confronto | `competitions[0].leg` | Objeto com `value` 1 ou 2 e `displayValue` "1st Leg" ou "2nd Leg"; ausente em grupo e em jogo único |
| Confronto | `competitions[0].series` | Objeto com `title` da fase, `totalCompetitions` igual a 2, `completed` e a lista de times do confronto; ausente em grupo e em jogo único |
| Agregado | `competitors[].aggregateScore` e `series.competitors[].aggregateScore` | Número nos dois lugares na volta, com o mesmo valor por time; ausente na ida |
| Disputa de pênaltis | `competitors[].shootoutScore` | Número nos dois competidores quando o jogo termina nos pênaltis; ausente nos demais jogos |
| Vencedor e classificado | `competitors[].winner` e `series.competitors[].winner` | Na volta, a `series` marca um único `winner`, o classificado; em jogo único de pênaltis, o `winner` do competidor marca quem avançou |

As notas em `competitions[0].notes` repetem parte dessas informações em texto livre em inglês. A volta de Fluminense x Independiente Rivadavia traz a nota "2nd Leg - Tied on aggregate - FLU win 5-4 on penalties". O parser dos próximos tickets lê os campos estruturados da tabela e trata a nota como texto de apoio. A nota muda de redação entre competições e não sustenta regra de negócio.

O vínculo entre ida e volta usa campos explícitos. `leg.value` diz a perna e `series` agrupa o confronto com `totalCompetitions` igual a 2. O par se confirma pelos dois `team.id`, com o mando invertido entre as pernas. O mandante da ida vira o visitante da volta. A ida traz `series.completed` igual a `false` e nenhum `aggregateScore`; a volta traz `completed` igual a `true` e o agregado fechado. O classificado sai de `series.competitors[].winner` na volta, e esse campo resolve também o caso em que o vencedor do jogo perde a classificação, como mostra a amostra da Libertadores abaixo.

## Vereditos por competição

| Competição | Slug | Veredito |
| --- | --- | --- |
| CONMEBOL Libertadores | `conmebol.libertadores` | Aprovada |
| CONMEBOL Sul-Americana | `conmebol.sudamericana` | Aprovada |
| Copa do Brasil | `bra.copa_do_brazil` | Aprovada |

### CONMEBOL Libertadores

A Libertadores está aprovada como provider primário do lote.

O calendário da temporada em `leagues[0].calendar[0].entries` lista 8 fases, da First Stage de fevereiro à Final de 28 de novembro. O `season.slug` de cada evento acompanha a fase: `first-stage`, `group-stage`, `round-of-16`, `quarterfinals` e `semifinals` aparecem nas amostras salvas. A First Stage já é confronto de ida e volta. The Strongest 2 x 1 Deportivo Táchira em 4 de fevereiro veio com `leg.value` 1 e `series` aberta. O jogo de grupo Deportivo La Guaira 0 x 0 Fluminense em 7 de abril veio com `group` "Group C" e sem `leg` e sem `series`. O confronto de oitavas entre Fluminense e Independiente Rivadavia fecha o ciclo completo na fixture. A ida terminou 0 x 0 em 11 de agosto, a volta terminou 1 x 1 em 18 de agosto, o agregado fechou 1 x 1, a disputa de pênaltis terminou 5 x 4 para o Fluminense e a `series` completa marca o Fluminense como classificado.

A amostra das quartas separa vencedor do jogo de classificado. Em 16 de setembro, a Liga de Quito venceu o Palmeiras por 3 x 2 no jogo da volta, o agregado fechou 3 x 3 e o Palmeiras venceu a disputa de pênaltis por 4 x 3. O competidor Palmeiras tem `score` "2", `shootoutScore` 4 e `winner` igual a `true`. Um parser que lesse só o placar do jogo classificaria o time errado.

### CONMEBOL Sul-Americana

A Sul-Americana está aprovada como provider primário do lote.

O calendário lista 7 fases, da First Stage de março à Final de 21 de novembro, e inclui a fase intermediária Knockout Round Playoffs de julho, que a Libertadores não tem. O `season.slug` acompanha cada fase: `first-stage`, `group-stage`, `knockout-round-playoffs`, `round-of-16` e `quarterfinals` aparecem nas amostras. A First Stage é jogo único. Independiente Petrolero 0 x 0 Guabirá em 3 de março terminou com disputa de pênaltis 3 x 2, sem `leg` e sem `series`, e o classificado sai do `winner` do competidor. O jogo de grupo Independiente Petrolero 1 x 3 Racing Club em 7 de abril veio com `group` "Group E".

Os confrontos de ida e volta seguem o mesmo contrato da Libertadores. O playoff de julho entre O'Higgins e Boca Juniors fechou na volta de 31 de julho com agregado 1 x 1 e pênaltis 4 x 3 para o Boca Juniors. As quartas entre Santos e Atlético-MG trazem o par completo na fixture. A ida terminou 2 x 0 para o Santos em 9 de setembro e a volta terminou 4 x 2 para o Atlético-MG em 16 de setembro, com agregado 4 x 4, pênaltis 3 x 1 para o Atlético-MG e `series.completed` igual a `true`.

### Copa do Brasil

A Copa do Brasil está aprovada como provider primário do lote, com uma regra de modelagem que a seção de riscos detalha.

O calendário lista 9 fases, da First Round de fevereiro à Final de 6 de dezembro, e a competição não tem fase de grupos. As quatro primeiras rodadas são jogo único. A amostra da First Round, Sampaio Corrêa RJ 1 x 1 Ferroviária em 17 de fevereiro, terminou em disputa de pênaltis 3 x 1 sem `leg` e sem `series`. A amostra da Third Round, Portuguesa 1 x 1 Avaí em 10 de março, repete o mesmo formato. Da Fifth Round em diante o confronto vira ida e volta. Botafogo 1 x 0 Chapecoense em 21 de abril já veio com `leg.value` 1 e `series` aberta, e o par das oitavas entre Vasco da Gama e Fluminense fecha com ida 0 x 0 em 1 de agosto, volta 3 x 1 para o Vasco em 6 de agosto e agregado 3 x 1 na `series`. A semifinal futura Palmeiras x Vasco da Gama de 1 de novembro prova a descoberta de confrontos. O evento está em estado `pre` e já traz `leg` e `series` montados.

## Pênaltis nas três competições

A coleta procurou disputa de pênaltis nas três competições em janelas de mata-mata de fevereiro a setembro de 2026 e encontrou nas três. A varredura por dia somou 140 eventos únicos nessas janelas, com 27 encerrados em `STATUS_FINAL_PEN`: 4 na Libertadores, 3 na Sul-Americana e 20 na Copa do Brasil. Cada um desses jogos traz `shootoutScore` nos dois competidores e marca o vencedor da disputa com `winner` igual a `true`. Nas voltas de confronto, o vencedor dos pênaltis coincide com o `winner` da `series`. As fixtures guardam ao menos um jogo de pênaltis por competição, e o teste de contrato confere placar da disputa, vencedor e classificado em cada um. O bônus de pênaltis do Palpitae lê `shootoutScore` e o `winner` do competidor, sem depender do texto das notas.

## Lacunas e riscos para os próximos tickets

A busca é de um dia por chamada e o intervalo de datas responde HTTP 400. Descobrir uma temporada inteira pede uma chamada por dia dentro das janelas de fase de `leagues[0].calendar[0].entries`, e essas janelas cobrem o ano quase inteiro nas três competições. O sync diário dos próximos tickets busca os dias próximos da rodada corrente e trata a carga histórica da temporada como backfill separado, com o custo de chamadas proporcional aos dias varridos. O desenho desse sync define a janela de varredura antes de qualquer código de provider entrar em produção.

O campo `season.type` é um identificador numérico da fase e a numeração não segue a ordem do calendário. Na Copa do Brasil, `first-round` vale 14065 e `semifinals` vale 14066, enquanto `round-of-16` vale 14060. Na Libertadores os valores descem conforme a fase avança: `group-stage` vale 13925 e `semifinals` vale 13922. O mapeamento de fases usa `season.slug`, que é estável e legível, e ignora o número.

A Copa do Brasil muda de formato no meio da competição. First Round a Fourth Round são jogo único com decisão por pênaltis no empate, e Fifth Round em diante é confronto de ida e volta. O modelo de confronto dos próximos tickets representa os dois formatos. Jogo único tem confronto de uma partida só, sem agregado, e o classificado sai do `winner` do competidor ou da disputa de pênaltis. A Sul-Americana tem a mesma dualidade em escala menor, com First Stage em jogo único e o restante em ida e volta, e a Libertadores abre com três fases preliminares de ida e volta antes dos grupos.

O agregado só existe depois da volta. A ida não traz `aggregateScore` em nenhum competidor, e o valor aparece fechado na volta em `competitors[].aggregateScore` e em `series.competitors[].aggregateScore`. Quem grava o agregado no banco lê a volta encerrada ou soma os placares das duas pernas já gravadas. Os dois caminhos chegaram ao mesmo número nas amostras. A volta de Fluminense x Vasco da Gama registra agregado 3 x 1, que é a soma do 0 x 0 da ida com o 3 x 1 da volta.

Os nomes de times seguem o padrão da ESPN em inglês e espanhol, com formas como Liga de Quito, Independiente Rivadavia e Atlético-MG convivendo no mesmo payload. Como provider primário, a ESPN passa a ser a dona dos nomes e dos `team.id` dessas competições, e o cadastro de times nasce dos ids dela. Nomes que o produto exibe em português pedem revisão editorial ou uma tabela de tradução no sync, no mesmo espírito do `TEAM_TRANSLATIONS` que o sync atual aplica aos nomes da football-data.org.

As finais das três competições são jogo único, em 28 de novembro na Libertadores, 21 de novembro na Sul-Americana e 6 de dezembro na Copa do Brasil. As amostras deste spike param nas semifinais e nenhum evento de final entrou nas fixtures, porque as finais de 2026 ainda não aconteceram. O formato esperado repete o jogo único das rodadas iniciais da Copa do Brasil, sem `leg` e sem `series`, e o ticket de implementação confere esse formato quando a primeira final entrar no scoreboard.

Jogo adiado ou remarcado ficou fora das amostras. Nenhum evento das janelas varridas veio em estado de adiamento, e o comportamento da ESPN para remarcação de confronto de mata-mata segue sem prova neste spike. O risco repete o desenho atual. O sync diário da ADR-013 resgata jogos sem resultado, e o parser novo trata payload fora do contrato como ausência de casamento, no padrão fail-closed que `api/src/matches/espnFallback.ts` já usa.

A API segue sem documentação oficial e sem SLA, risco que a ADR-015 e a ADR-016 já aceitaram para o radar e para o fallback. Como provider primário o peso desse risco sobe, porque a ESPN passa a criar os confrontos dessas competições no banco. O contrato salvo nas fixtures e o teste `api/src/providers/espnFixtures.test.ts` viram o alarme de mudança de schema. Se a ESPN renomear `leg`, `series` ou `shootoutScore`, o teste quebra antes de o sync gravar dado errado. A decisão final de promover a ESPN a provider primário fica registrada na ADR-018.

## Reprodução das chamadas

Os comandos abaixo repetem as consultas centrais deste spike. A troca do dia no parâmetro `dates` alcança qualquer rodada da temporada 2026.

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard?dates=20260818"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.sudamericana/scoreboard?dates=20260916"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=20260217"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard"
```
