# Spike ESPN como fonte do Campeonato Mineiro

## Objetivo

Este documento registra o resultado do spike que avaliou a API pública da ESPN como fonte de confrontos para o Campeonato Mineiro (`bra.camp.mineiro`). O proxy de validação é a temporada 2026; o alvo de cadastro futuro é a temporada 2027. O spike é independente e fecha o gate GO/NO-GO desta competição. Este relatório não altera comportamento de produção: nenhum provider novo entra no sync, a competição não nasce no banco e `ESPN_PRIMARY_COMPETITIONS` permanece intacto.

## Método

A coleta consultou a API ao vivo em 24 de outubro de 2026, sem autenticação, pelo endpoint `GET https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=YYYYMMDD`. A pesquisa leu o calendário plano da temporada (23 datas), percorreu cada dia com intervalo de cerca de 1,3 s entre chamadas e acumulou 59 eventos únicos. As amostras cobrem a fase classificatória em grupos (`regular-season`), as semifinais e a final do Troféu Inconfidência, as semifinais dos playoffs e a final do título. A temporada 2026 já estava encerrada na coleta; não havia jogo futuro nem placeholder TBD no calendário. O JSON bruto ficou fora do repositório (`~/.cache/palpitae-mineiro-research/`), com proveniência por arquivo (`url`, `fetched_at`, `collection_key`).

O calendário ESPN usa datas ISO cujo dia UTC pode diferir do kickoff em BRT. Jogos com `event.date` em `2026-01-15T00:00Z` e `2026-01-15T00:30Z` vieram na consulta `dates=20260114`. A reprodução abaixo usa a chave de coleta real, não o dia UTC do kickoff.

O recorte de contrato deste spike está em `api/src/providers/__fixtures__/espn-bra-camp-mineiro-scoreboard.json`, no mesmo estilo das fixtures de copa e da Série B: campos pesados removidos (`details`, `odds`, `broadcasts`, `links`, `statistics`) e eventos de dias diferentes reunidos num único scoreboard. A fixture guarda 3 jogos de `regular-season` (grupos A, B e C), o par ida/volta de uma semifinal do Troféu Inconfidência decidida nos pênaltis, o par ida/volta de uma semifinal dos playoffs decidida nos pênaltis, o par ida/volta da final do Troféu Inconfidência e a final dos playoffs em jogo único. O calendário da fixture é uma amostra de 13 datas ISO tirada das 23 datas ao vivo. O teste `api/src/providers/espnFixtures.test.ts` (bloco `fixture ESPN bra.camp.mineiro`) fixa os campos que sustentam o veredito.

## Contrato observado

| Requisito | Campo no payload | Comportamento observado |
| --- | --- | --- |
| Data e hora | `events[].date` | ISO 8601 em UTC, presente em todos os 59 eventos amostrados |
| Mandante e visitante | `competitions[0].competitors[]` com `homeAway` | Dois competidores, `team.id` numérico estável e `team.displayName` |
| Placar | `competitors[].score` | String numérica em jogo encerrado |
| Jogo encerrado | `competitions[0].status.type` | `state=post`; `name=STATUS_FULL_TIME` com `detail=FT`, ou `name=STATUS_FINAL_PEN` com `detail=FT-Pens` |
| Temporada / fase | `events[].season.slug` | Cinco valores: `regular-season`, `trofeu-inconfidencia---semifinals`, `trofeu-inconfidencia---finals`, `playoffs---semifinals`, `playoffs---final` |
| Grupo | `competitions[0].group` | Presente na classificatória (`Group A`/`B`/`C`, `groupId` `1`/`2`/`3`); ausente no mata-mata |
| Ida/volta | `competitions[0].leg` / `series` | Presentes nas semifinais e na final do Troféu Inconfidência e nas semifinais dos playoffs; ausentes na classificatória e na final dos playoffs |
| Agregado | `competitors[].aggregateScore` e `series.competitors[].aggregateScore` | Número na volta; ausente na ida |
| Disputa de pênaltis | `competitors[].shootoutScore` e `winner` | Presentes nas voltas das semifinais do Troféu Inconfidência (North EC 4 x 3 Uberlândia) e dos playoffs (Atlético-MG 4 x 2 América Mineiro) |
| Classificado em ida/volta | `series.competitors[].winner` | Na volta, a `series` marca um único `winner` |
| Classificado em jogo único | `competitors[].winner` | Na final dos playoffs, Cruzeiro marca `winner=true` sem `series` |
| Rodada numérica | `events[].week` / `events[].matchday` | Ausentes no scoreboard ao vivo |
| Placeholder TBD | `team.displayName` + `status.detail` | Não apareceu nas 23 datas da temporada 2026 encerrada |
| Calendário | `leagues[0].calendar` | Lista plana de datas ISO (`calendarType=day`), 23 entradas ao vivo |

O `altGameNote` veio sempre como `Brazil Mineiro`. O parser futuro lê a fase em `season.slug`. O `altGameNote` fixo `Brazil Mineiro` não identifica a fase.

## Formato e type recomendado

O Mineiro 2026 tem fases distintas no `season.slug`: classificatória em grupos (`regular-season`), Troféu Inconfidência (semifinais e final em ida e volta) e playoffs (semifinais em ida e volta, final em jogo único). Pelo critério do lote (cup quando as fases vêm fatiadas no slug), o type recomendado para cadastro futuro é `cup`.

O calendário plano (`calendarType=day`) tem o formato de liga. O contrato dos eventos é de copa com fases no `season.slug` e grupos na classificatória. O catálogo de descoberta da ESPN não define o `type` do cadastro piloto.

## Mapeamento atual do sync e fases novas

`resolveEspnStage` em `api/src/matches/espnSync.ts` não mapeia nenhum dos cinco slugs observados. Nenhum casa com o padrão `YYYY-…` de liga. Até o ticket de parser, um sync piloto importaria zero jogos deste slug (fail-closed).

| Slug observado | Situação no mapa atual | Ação sugerida no ticket de parser |
| --- | --- | --- |
| `regular-season` | Ausente; não casa com `YYYY-…` | Mapear no `ESPN_STAGE_MAP` (ex.: fase de grupos / `REGULAR_SEASON`, decisão desse ticket) |
| `trofeu-inconfidencia---semifinals` | Ausente | Mapear para código de semifinal do troféu (rótulo PT-BR próprio) |
| `trofeu-inconfidencia---finals` | Ausente; o mapa tem só `final` (singular) | Mapear `…---finals` → fase final do troféu |
| `playoffs---semifinals` | Ausente | Mapear para semifinal dos playoffs |
| `playoffs---final` | Ausente | Mapear para final do título |

Este spike lista as fases novas para o ticket 08 e não implementa o parser.

## Veredito

| Competição | Slug | Tipo recomendado | Veredito |
| --- | --- | --- | --- |
| Campeonato Mineiro | `bra.camp.mineiro` | `cup` | **GO** para o ticket futuro de parser e cadastro 2027 |

O endpoint responde com slug válido, placares encerrados, grupos na classificatória, pênaltis estruturados, ida/volta com `leg`/`series`/agregado e final do título em jogo único. O GO depende do ticket de parser acrescentar os cinco slugs ao mapa. Este spike não registra a competição em produção.

## Lacunas conscientes

- Placeholder TBD e jogo futuro (`state=pre`) não entraram nas amostras porque a temporada 2026 já estava fechada. O comportamento TBD permanece o das outras fixtures ESPN (`isEspnPlaceholder`), sem prova nova neste slug.
- Pênaltis na final do Troféu Inconfidência e na final dos playoffs não apareceram em 2026. O contrato de `shootoutScore` veio das voltas das semifinais.
- Sem `week`/`matchday`, a rodada canônica na classificatória fica a própria fase até haver fonte alternativa de número de rodada.
- Nomes seguem o padrão ESPN (`América Mineiro`, `Atlético-MG`, `Democrata GV`, `North EC`); revisão editorial/`TEAM_TRANSLATIONS` é opcional.
- A API segue sem documentação oficial nem SLA. Risco já aceito na ADR-018, mitigado por fixture + teste de contrato.

## Reprodução

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260110"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260111"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260114"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260221"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260222"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260301"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260304"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260307"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.mineiro/scoreboard?dates=20260308"
```
