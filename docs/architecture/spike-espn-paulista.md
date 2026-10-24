# Spike ESPN como fonte do Campeonato Paulista

## Objetivo

Este documento registra o resultado do spike que avaliou a API pública da ESPN como fonte de confrontos para o Campeonato Paulista (`bra.camp.paulista`). O proxy de validação é a temporada 2026; o alvo de cadastro futuro é a temporada 2027. O spike é independente e fecha o gate GO/NO-GO desta competição. Este relatório não altera comportamento de produção: nenhum provider novo entra no sync, a competição não nasce no banco e `ESPN_PRIMARY_COMPETITIONS` permanece intacto.

## Método

A coleta consultou a API ao vivo em 24 de outubro de 2026, sem autenticação, pelo endpoint `GET https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.paulista/scoreboard?dates=YYYYMMDD`. A pesquisa leu o calendário plano da temporada (26 datas), percorreu cada dia com intervalo de cerca de 1,2 s entre chamadas (rajada gera HTTP 403 da Akamai) e acumulou 72 eventos. As amostras cobrem fase classificatória (`league-phase`), quartas, semifinais e final com placar conhecido. A temporada 2026 já estava encerrada na coleta; não havia jogo futuro nem placeholder TBD no calendário. O JSON bruto ficou fora do repositório (`~/.cache/palpitae-paulista-research/`).

O recorte de contrato deste spike está em `api/src/providers/__fixtures__/espn-bra-camp-paulista-scoreboard.json`, no mesmo estilo das fixtures de copa e da Série B: campos pesados removidos (`details`, `odds`, `broadcasts`, `links`, `statistics`) e eventos de dias diferentes reunidos num único scoreboard. A fixture guarda 2 jogos de `league-phase`, 1 quarta encerrada no tempo regulamentar, 1 quarta decidida nos pênaltis, 1 semifinal e o par ida/volta da final. O calendário da fixture é uma amostra de 10 datas ISO tirada das 26 datas ao vivo. O teste `api/src/providers/espnFixtures.test.ts` (bloco `fixture ESPN bra.camp.paulista`) fixa os campos que sustentam o veredito.

## Contrato observado

| Requisito | Campo no payload | Comportamento observado |
| --- | --- | --- |
| Data e hora | `events[].date` | ISO 8601 em UTC, presente em todos os 72 eventos amostrados |
| Mandante e visitante | `competitions[0].competitors[]` com `homeAway` | Dois competidores, `team.id` numérico estável e `team.displayName` |
| Placar | `competitors[].score` | String numérica em jogo encerrado |
| Jogo encerrado | `competitions[0].status.type` | `state=post`; `name=STATUS_FULL_TIME` com `detail=FT`, ou `name=STATUS_FINAL_PEN` com `detail=FT-Pens` |
| Temporada / fase | `events[].season.slug` | Quatro valores: `league-phase`, `quarterfinals`, `semifinals`, `finals` |
| Grupo | `competitions[0].group` | Ausente em todos os eventos, inclusive na classificatória |
| Ida/volta | `competitions[0].leg` / `series` | Presentes só na final (`leg.value` 1 ou 2, `series.title=Finals`, `totalCompetitions=2`); ausentes em classificatória, quartas e semifinais |
| Agregado | `competitors[].aggregateScore` e `series.competitors[].aggregateScore` | Número na volta da final; ausente na ida |
| Disputa de pênaltis | `competitors[].shootoutScore` e `winner` | Presentes na quarta Portuguesa 1 x 1 Corinthians (`STATUS_FINAL_PEN`, pênaltis 7 x 8) |
| Classificado em jogo único | `competitors[].winner` | Marca quem avançou em quartas e semifinais sem `series` |
| Classificado em ida/volta | `series.competitors[].winner` | Na volta da final, a `series` marca um único `winner` (Palmeiras) |
| Rodada numérica | `events[].week` / `events[].matchday` | Ausentes no scoreboard ao vivo |
| Placeholder TBD | `team.displayName` + `status.detail` | Não apareceu nas 26 datas da temporada 2026 encerrada |
| Calendário | `leagues[0].calendar` | Lista plana de datas ISO (`calendarType=day`), 26 entradas ao vivo |

O `altGameNote` veio sempre como `Brazil Paulista` e não repete o nome da fase. O parser futuro deve ler `season.slug`, não o texto da nota.

## Formato e type recomendado

O Paulista 2026 tem fases distintas no `season.slug`: classificatória (`league-phase`), depois mata-mata em jogo único nas quartas e semifinais, e final em ida e volta. Pelo critério do lote (cup quando as fases vêm fatiadas no slug), o type recomendado para cadastro futuro é `cup`.

O calendário plano (`calendarType=day`) parece o de uma liga, mas o contrato dos eventos é de copa com fases. O radar já lista `bra.camp.paulista` como `League` só no catálogo de descoberta; isso não define o `type` do cadastro piloto.

## Mapeamento atual do sync e fases novas

`resolveEspnStage` em `api/src/matches/espnSync.ts` já mapeia `quarterfinals` e `semifinals`. Dois slugs do Paulista ficam de fora do contrato atual e seriam descartados (fail-closed):

| Slug observado | Situação no mapa atual | Ação sugerida no ticket de parser |
| --- | --- | --- |
| `league-phase` | Ausente; não casa com o padrão `YYYY-…` de liga | Incluir no `ESPN_STAGE_MAP` (ex.: `LEAGUE_PHASE` ou reuso de `REGULAR_SEASON`, decisão do ticket de parser) |
| `finals` | Ausente; o mapa tem só `final` (singular) | Incluir `finals` → `FINAL` |
| `quarterfinals` | Já mapeado | Nenhuma |
| `semifinals` | Já mapeado | Nenhuma |

Até esse ticket, um sync piloto importaria só quartas e semifinais e descartaria classificatória e final.

## Veredito

| Competição | Slug | Tipo recomendado | Veredito |
| --- | --- | --- | --- |
| Campeonato Paulista | `bra.camp.paulista` | `cup` | **GO** para o ticket futuro de parser e cadastro 2027 |

O endpoint responde com slug válido, placares encerrados, pênaltis estruturados, final com `leg`/`series`/agregado e fases legíveis. O GO depende do ticket de parser acrescentar `league-phase` e `finals` ao mapa. Este spike não registra a competição em produção.

## Lacunas conscientes

- Placeholder TBD e jogo futuro (`state=pre`) não entraram nas amostras porque a temporada 2026 já estava fechada. O comportamento TBD permanece o das outras fixtures ESPN (`isEspnPlaceholder`), sem prova nova neste slug.
- A ESPN não expôs `group` na classificatória. Se o produto precisar de chave de grupo, outra fonte ou endpoint será necessário; este scoreboard não entrega.
- Pênaltis na final (agregado empatado) não apareceram em 2026. O contrato de `shootoutScore` veio da quarta em jogo único.
- Sem `week`/`matchday`, a rodada canônica na classificatória fica a própria fase até haver fonte alternativa de número de rodada.
- Nomes seguem o padrão ESPN (`AE Velo Clube`, `Primavera SP`, `Red Bull Bragantino`); revisão editorial/`TEAM_TRANSLATIONS` é opcional.
- A API segue sem documentação oficial nem SLA. Risco já aceito na ADR-018, mitigado por fixture + teste de contrato.

## Reprodução

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.paulista/scoreboard?dates=20260110"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.paulista/scoreboard?dates=20260222"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.paulista/scoreboard?dates=20260301"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.paulista/scoreboard?dates=20260304"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.paulista/scoreboard?dates=20260308"
```
