# Spike ESPN como fonte do Campeonato Gaúcho

## Objetivo

Este documento registra o resultado do spike que avaliou a API pública da ESPN como fonte de confrontos para o Campeonato Gaúcho (`bra.camp.gaucho`). O proxy de validação é a temporada 2026; o alvo de cadastro futuro é a temporada 2027. O spike é independente e fecha o gate GO/NO-GO desta competição. Este relatório não altera comportamento de produção: nenhum provider novo entra no sync, a competição não nasce no banco e `ESPN_PRIMARY_COMPETITIONS` permanece intacto.

## Método

A coleta consultou a API ao vivo em 24 de outubro de 2026, sem autenticação, pelo endpoint `GET https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=YYYYMMDD`. A pesquisa leu o calendário plano da temporada (29 datas), percorreu cada dia com intervalo de cerca de 1,3 s entre chamadas e acumulou 64 eventos únicos. As amostras cobrem a fase inicial (`first-round`), o grupo de rebaixamento (`gaucho---relegation`), as quartas, as semifinais e a final do título, além das semifinais e da final do Farroupilha. A temporada 2026 já estava encerrada na coleta; não havia jogo futuro nem placeholder TBD no calendário. O JSON bruto ficou fora do repositório (`~/.cache/palpitae-gaucho-research/`), com proveniência por arquivo (`collection_key`, `url`, `event_id`).

O calendário ESPN usa datas ISO cujo dia UTC pode diferir do kickoff em BRT. O jogo Avenida x Grêmio com `event.date` em `2026-01-11T00:00Z` veio na consulta `dates=20260110`. A reprodução abaixo usa a chave de coleta real, não o dia UTC do kickoff. Mandante e visitante nessa chamada batem com a fixture (`home=Avenida`, `away=Grêmio`).

O recorte de contrato deste spike está em `api/src/providers/__fixtures__/espn-bra-camp-gaucho-scoreboard.json`, no mesmo estilo das fixtures de copa e da Série B: campos pesados removidos (`details`, `odds`, `broadcasts`, `links`, `statistics`) e eventos de dias diferentes reunidos num único scoreboard. A fixture guarda 2 jogos de `first-round` (um com Group A e o Grenal sem group), 1 jogo de rebaixamento, 1 quarta em jogo único, o par ida/volta de uma semifinal do Farroupilha decidida nos pênaltis, o par ida/volta de uma semifinal do título decidida nos pênaltis, o par ida/volta da final do título (Grenal) e o par ida/volta da final do Farroupilha. O calendário da fixture é uma amostra de 14 datas ISO tirada das 29 datas ao vivo. O teste `api/src/providers/espnFixtures.test.ts` (bloco `fixture ESPN bra.camp.gaucho`) fixa os campos que sustentam o veredito.

## Contrato observado

| Requisito | Campo no payload | Comportamento observado |
| --- | --- | --- |
| Data e hora | `events[].date` | ISO 8601 em UTC, presente em todos os 64 eventos amostrados |
| Mandante e visitante | `competitions[0].competitors[]` com `homeAway` | Dois competidores, `team.id` numérico estável e `team.displayName` |
| Placar | `competitors[].score` | String numérica em jogo encerrado |
| Jogo encerrado | `competitions[0].status.type` | `state=post`; `name=STATUS_FULL_TIME` com `detail=FT`, ou `name=STATUS_FINAL_PEN` com `detail=FT-Pens` |
| Temporada / fase | `events[].season.slug` | Sete valores: `first-round`, `gaucho---relegation`, `quarterfinals`, `farroupilha---semifinals`, `semifinals`, `finals`, `farroupilha---finals` |
| Grupo | `competitions[0].group` | Parcial na `first-round` (6 de 36 com `2026 Campeonato Gaúcho - Group A`); sempre `Relegation Group` em `gaucho---relegation`; ausente no mata-mata |
| Ida/volta | `competitions[0].leg` / `series` | Presentes nas semifinais e finais do título e do Farroupilha; ausentes em `first-round`, rebaixamento e quartas |
| Agregado | `competitors[].aggregateScore` e `series.competitors[].aggregateScore` | Número na volta; ausente na ida |
| Disputa de pênaltis | `competitors[].shootoutScore` e `winner` | Presentes nas voltas das semifinais do Farroupilha (São Luiz-RS 3 x 2 Caxias) e do título (Grêmio 4 x 1 Juventude) |
| Classificado em jogo único | `competitors[].winner` | Marca quem avançou nas quartas sem `series` |
| Classificado em ida/volta | `series.competitors[].winner` | Na volta, a `series` marca um único `winner` |
| Rodada numérica | `events[].week` / `events[].matchday` | Ausentes no scoreboard ao vivo |
| Placeholder TBD | `team.displayName` + `status.detail` | Não apareceu nas 29 datas da temporada 2026 encerrada |
| Calendário | `leagues[0].calendar` | Lista plana de datas ISO (`calendarType=day`), 29 entradas ao vivo |

O `altGameNote` veio sempre como `Brazil Gaucho`. O parser futuro lê a fase em `season.slug`. O `altGameNote` fixo `Brazil Gaucho` não identifica a fase.

## Formato específico da fase inicial

A fase inicial gaúcha chega como `season.slug=first-round`. Não há `leg` nem `series`. O campo `group` é incompleto: só 6 dos 36 jogos da fase trouxeram `group.name=2026 Campeonato Gaúcho - Group A` (`groupId=1`). Os demais, inclusive o Grenal Internacional 4 x 2 Grêmio de 25 de janeiro, vieram sem `group`. Quem precisar de chave de grupo por jogo não pode depender só deste scoreboard.

Depois da `first-round` a ESPN separa o caminho do título (`quarterfinals` → `semifinals` → `finals`) do Farroupilha (`farroupilha---semifinals` → `farroupilha---finals`) e do rebaixamento (`gaucho---relegation` com `Relegation Group`). As quartas são jogo único. Semifinais e finais do título e do Farroupilha usam ida e volta com `leg`/`series`.

## Formato e type recomendado

O Gaúcho 2026 tem fases distintas no `season.slug`. Pelo critério do lote (cup quando as fases vêm fatiadas no slug), o type recomendado para cadastro futuro é `cup`.

O calendário plano (`calendarType=day`) tem o formato de liga. O contrato dos eventos é de copa com fases no `season.slug`, rebaixamento e dois caminhos de mata-mata. O radar lista `bra.camp.gaucho` como `League` no catálogo de descoberta. Esse catálogo não define o `type` do cadastro piloto.

## Mapeamento atual do sync e fases novas

Lookup literal em `ESPN_STAGE_MAP` e em `resolveEspnStage` (`api/src/matches/espnSync.ts`), na base deste spike:

| Slug observado | Situação no mapa | Nota |
| --- | --- | --- |
| `first-round` | Contextual em `bra.camp.gaucho` → `GROUP_STAGE` | Classificatória de grupos; outras copas mantêm `FIRST_ROUND` eliminatório |
| `quarterfinals` | `QUARTER_FINALS` | Mata-mata |
| `semifinals` | `SEMI_FINALS` | Mata-mata |
| `gaucho---relegation` | `RELEGATION_STAGE` | Ticket 08 |
| `farroupilha---semifinals` | `FARROUPILHA_SEMI_FINALS` | Ticket 08 |
| `farroupilha---finals` | `FARROUPILHA_FINAL` | Ticket 08 |
| `finals` | `FINAL` | Ticket 08 |

A exceção `bra.camp.gaucho` + `first-round` → `GROUP_STAGE` evita `tie_role`/bônus de classificado na fase de pontos. A chave é competição + slug; o campo `group` incompleto não entra na decisão.

## Veredito

| Competição | Slug | Tipo recomendado | Veredito |
| --- | --- | --- | --- |
| Campeonato Gaúcho | `bra.camp.gaucho` | `cup` | **GO** para o ticket futuro de parser e cadastro 2027 |

O endpoint responde com slug válido, placares encerrados, formato inicial próprio, rebaixamento com grupo, pênaltis estruturados, ida/volta com `leg`/`series`/agregado e Grenal na fase de grupos e na final. O GO depende do ticket 08 acrescentar as quatro fases novas ao mapa. Este spike não registra a competição em produção.

## Lacunas conscientes

- Placeholder TBD e jogo futuro (`state=pre`) não entraram nas amostras porque a temporada 2026 já estava fechada. O comportamento TBD permanece o das outras fixtures ESPN (`isEspnPlaceholder`), sem prova nova neste slug.
- O campo `group` na `first-round` é incompleto (só Group A em parte dos jogos). Não há Group B/C neste scoreboard.
- Pênaltis nas finais do título e do Farroupilha não apareceram em 2026. O contrato de `shootoutScore` veio das voltas das semifinais.
- Sem `week`/`matchday`, a rodada canônica na fase inicial fica a própria fase até haver fonte alternativa de número de rodada.
- Nomes seguem o padrão ESPN (`São Luiz-RS`, `São José-RS`, `Caxias do Sul`, `Guarany de Bagé`); revisão editorial/`TEAM_TRANSLATIONS` é opcional.
- A API segue sem documentação oficial nem SLA. Risco já aceito na ADR-018, mitigado por fixture + teste de contrato.

## Reprodução

As chaves abaixo são as de coleta real. `dates=20260110` devolve o Avenida x Grêmio com `date=2026-01-11T00:00Z` (dia UTC distinto da chave BRT).

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260110"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260125"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260206"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260215"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260216"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260221"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260222"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260301"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260302"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260306"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.gaucho/scoreboard?dates=20260308"
```
