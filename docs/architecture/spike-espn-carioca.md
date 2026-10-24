# Spike ESPN como fonte do Campeonato Carioca

## Objetivo

Este documento registra o resultado do spike que avaliou a API pública da ESPN como fonte de confrontos para o Campeonato Carioca (`bra.camp.carioca`). O proxy de validação é a temporada 2026; o alvo de cadastro futuro é a temporada 2027. O spike é independente e fecha o gate GO/NO-GO desta competição. Este relatório não altera comportamento de produção: nenhum provider novo entra no sync, a competição não nasce no banco e `ESPN_PRIMARY_COMPETITIONS` permanece intacto.

## Método

A coleta consultou a API ao vivo em 24 de outubro de 2026, sem autenticação, pelo endpoint `GET https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.carioca/scoreboard?dates=YYYYMMDD`. A pesquisa leu o calendário plano da temporada (33 datas), percorreu cada dia com intervalo de cerca de 1,3 s entre chamadas (rajada gera HTTP 403 da Akamai) e acumulou 62 eventos. As amostras cobrem Taça Guanabara (fase de pontos e mata-mata), Taça Rio (semifinais e final) e a fase de rebaixamento, todas com placar conhecido. A temporada 2026 já estava encerrada na coleta; não havia jogo futuro nem placeholder TBD no calendário. O JSON bruto ficou fora do repositório (`~/.cache/palpitae-carioca-research/`).

O recorte de contrato deste spike está em `api/src/providers/__fixtures__/espn-bra-camp-carioca-scoreboard.json`, no mesmo estilo das fixtures de copa e da Série B: campos pesados removidos (`details`, `odds`, `broadcasts`, `links`, `statistics`) e eventos de dias diferentes reunidos num único scoreboard. A fixture guarda 2 jogos de `taca-guanabara` (um com `group`, um sem), 1 quarta encerrada no tempo regulamentar, 1 quarta decidida nos pênaltis, o par ida/volta das semifinais da Taça Guanabara, a final da Taça Guanabara nos pênaltis, o par ida/volta das semifinais da Taça Rio, a final da Taça Rio e 1 jogo da fase de rebaixamento. O calendário da fixture é uma amostra de 10 datas ISO tirada das 33 datas ao vivo. O teste `api/src/providers/espnFixtures.test.ts` (bloco `fixture ESPN bra.camp.carioca`) fixa os campos que sustentam o veredito.

## Contrato observado

| Requisito | Campo no payload | Comportamento observado |
| --- | --- | --- |
| Data e hora | `events[].date` | ISO 8601 em UTC, presente em todos os 62 eventos amostrados |
| Mandante e visitante | `competitions[0].competitors[]` com `homeAway` | Dois competidores, `team.id` numérico estável e `team.displayName` |
| Placar | `competitors[].score` | String numérica em jogo encerrado |
| Jogo encerrado | `competitions[0].status.type` | `state=post`; `name=STATUS_FULL_TIME` com `detail=FT`, ou `name=STATUS_FINAL_PEN` com `detail=FT-Pens` |
| Temporada / fase | `events[].season.slug` | Sete valores: `taca-guanabara`, `taca-guanabara---quarterfinals`, `taca-guanabara---semifinals`, `taca-guanabara---final`, `taca-rio---semifinals`, `taca-rio---final`, `relegation-stage` |
| Grupo | `competitions[0].group` | Presente em parte dos jogos de `taca-guanabara` (`Group B`) e em todos os de `relegation-stage` (`Relegation Group`); ausente no mata-mata |
| Ida/volta | `competitions[0].leg` / `series` | Presentes nas semifinais da Taça Guanabara e da Taça Rio (`leg.value` 1 ou 2, `series.totalCompetitions=2`); ausentes em fase de pontos, quartas, finais e rebaixamento |
| Agregado | `competitors[].aggregateScore` e `series.competitors[].aggregateScore` | Número na volta das semifinais; ausente na ida |
| Disputa de pênaltis | `competitors[].shootoutScore` e `winner` | Presentes na quarta Vasco 1 x 1 Volta Redonda (pênaltis 5 x 3) e na final Flamengo 0 x 0 Fluminense (pênaltis 5 x 4), ambas `STATUS_FINAL_PEN` |
| Classificado em jogo único | `competitors[].winner` | Marca quem avançou em quartas e finais sem `series` |
| Classificado em ida/volta | `series.competitors[].winner` | Na volta das semifinais, a `series` marca um único `winner` |
| Rodada numérica | `events[].week` / `events[].matchday` | Ausentes no scoreboard ao vivo |
| Placeholder TBD | `team.displayName` + `status.detail` | Não apareceu nas 33 datas da temporada 2026 encerrada |
| Calendário | `leagues[0].calendar` | Lista plana de datas ISO (`calendarType=day`), 33 entradas ao vivo |

O `altGameNote` veio sempre como `Brazil Carioca`. O parser futuro lê a fase em `season.slug`. O `altGameNote` fixo não identifica a fase. O `leagues[0].season.type.name` veio sempre como `Taça Guanabara - Final` em datas distintas e também não serve para mapear fase.

A ESPN codifica o hífen tipográfico do rótulo da fase com três hífens no slug. O rótulo `Taça Guanabara - Quarterfinals` vira `taca-guanabara---quarterfinals`. O mapa do parser precisa aceitar esses slugs literais.

## Formato e type recomendado

O Carioca 2026 tem fases distintas no `season.slug`: Taça Guanabara em pontos corridos, depois mata-mata próprio (quartas em jogo único, semifinais em ida e volta, final em jogo único), Taça Rio em mata-mata paralelo (semifinais em ida e volta, final em jogo único) e fase de rebaixamento com grupo. Pelo critério do lote (cup quando as fases vêm fatiadas no slug), o type recomendado para cadastro futuro é `cup`.

O calendário plano (`calendarType=day`) tem o formato de liga. O contrato dos eventos é de copa com fases no `season.slug`. Não há final geral do campeonato além de `taca-guanabara---final` nas 33 datas de 2026; o título estadual nessa edição, no payload da ESPN, encerra nessa final.

## Mapeamento atual do sync e fases novas

`resolveEspnStage` em `api/src/matches/espnSync.ts` não reconhece nenhum dos sete slugs do Carioca. Nenhum casa com o padrão `YYYY-…` de liga. Todos seriam descartados (fail-closed) até o ticket de parser:

| Slug observado | Situação no mapa atual | Ação sugerida no ticket de parser |
| --- | --- | --- |
| `taca-guanabara` | Ausente | Mapear no `ESPN_STAGE_MAP` (ex.: fase própria `TACA_GUANABARA` ou reuso de `REGULAR_SEASON`/`FIRST_STAGE`, decisão desse ticket) |
| `taca-guanabara---quarterfinals` | Ausente | Mapear para `QUARTER_FINALS` ou fase própria prefixada; o literal `---` precisa entrar no mapa |
| `taca-guanabara---semifinals` | Ausente | Mapear para `SEMI_FINALS` ou fase própria prefixada |
| `taca-guanabara---final` | Ausente | Mapear para `FINAL` ou fase própria; o mapa atual tem só `final` (singular, sem prefixo) |
| `taca-rio---semifinals` | Ausente | Mapear para `SEMI_FINALS` ou fase própria `TACA_RIO_SEMI_FINALS` |
| `taca-rio---final` | Ausente | Mapear para `FINAL` ou fase própria `TACA_RIO_FINAL` |
| `relegation-stage` | Ausente | Mapear (ex.: `RELEGATION_STAGE`); o grupo `Relegation Group` já vem em `competitions[0].group` |

Até esse ticket, um sync piloto do Carioca importaria zero jogos.

## Veredito

| Competição | Slug | Tipo recomendado | Veredito |
| --- | --- | --- | --- |
| Campeonato Carioca | `bra.camp.carioca` | `cup` | **GO** para o ticket futuro de parser e cadastro 2027 |

O endpoint responde com slug válido, placares encerrados, pênaltis estruturados em quarta e final, semifinais com `leg`/`series`/agregado e fases legíveis no `season.slug`. O GO depende do ticket de parser acrescentar os sete slugs ao mapa. Este spike não registra a competição em produção.

## Lacunas conscientes

- Placeholder TBD e jogo futuro (`state=pre`) não entraram nas amostras porque a temporada 2026 já estava fechada. O comportamento TBD permanece o das outras fixtures ESPN (`isEspnPlaceholder`), sem prova nova neste slug.
- Em `taca-guanabara`, o campo `group` aparece só em parte dos jogos e só como `Group B`. Não há amostra de `Group A` no scoreboard 2026. Se o produto precisar de chave de grupo estável na fase de pontos, outra fonte ou endpoint será necessário.
- Não há amostra de final geral do campeonato separada de `taca-guanabara---final` em 2026. O regulamento 2027 pode reintroduzir final estadual ou mudar o encadeamento Taça Guanabara / Taça Rio; o parser e o `penalty_phases` devem reconfirmar quando a ESPN publicar a edição 2027.
- Sem `week`/`matchday`, a rodada canônica na fase de pontos e no rebaixamento fica a própria fase até haver fonte alternativa de número de rodada.
- Nomes seguem o padrão ESPN (`Sampaio Correa RJ`, `Portuguesa-RJ`, `Nova Iguaçu`); revisão editorial/`TEAM_TRANSLATIONS` é opcional.
- A API segue sem documentação oficial nem SLA. Risco já aceito na ADR-018, mitigado por fixture + teste de contrato.

## Reprodução

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.carioca/scoreboard?dates=20260115"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.carioca/scoreboard?dates=20260214"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.carioca/scoreboard?dates=20260215"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.carioca/scoreboard?dates=20260222"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.carioca/scoreboard?dates=20260301"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.camp.carioca/scoreboard?dates=20260308"
```

O evento `401860540` (Vasco da Gama x Volta Redonda, kickoff `2026-02-15T00:30Z`, quarta nos pênaltis) entra no calendário ESPN em `dates=20260214`. A chave `dates` segue o dia do calendário local da liga; o kickoff em UTC cai no dia seguinte. A consulta `dates=20260215` devolve o Botafogo x Flamengo (`2026-02-15T20:30Z`). Amostra em cache: `~/.cache/palpitae-carioca-research/scoreboard_20260214.json`.
