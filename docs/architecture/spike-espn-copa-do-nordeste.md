# Spike ESPN como fonte da Copa do Nordeste

## Objetivo

Este documento registra o resultado do spike que avaliou a API pública da ESPN como fonte de confrontos para a Copa do Nordeste (`bra.copa_do_nordeste`). O proxy de validação é a temporada 2026; o alvo de cadastro futuro é a temporada 2027. O spike é independente e fecha o gate GO/NO-GO desta competição como ESPN-primária com `type = cup`. Este relatório não altera comportamento de produção: nenhum provider novo entra no sync, a competição não nasce no banco e `ESPN_PRIMARY_COMPETITIONS` permanece intacto.

## Método

A coleta consultou a API ao vivo em 24 de outubro de 2026, sem autenticação, pelo endpoint `GET https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_nordeste/scoreboard?dates=YYYYMMDD`. As chamadas foram serializadas com intervalo de cerca de 1,3 s. A pesquisa leu o calendário de fases, amostragem densa de maio (dias 8 a 28), datas de grupos em março/abril, quartas, semifinal e final, além do catálogo `sports.core.api.espn.com` em `lang=en` e `lang=pt` e do lookup direto do slug. O JSON bruto ficou fora do repositório em `~/.cache/palpitae-nordeste-research/`, com proveniência por chave de coleta (`nordeste_*.json`, `catalog_*.json`, `lookup_nordeste_en.json`, `nordeste_scan_*.json`, `nordeste_penhunt_*.json`).

O parâmetro `dates=YYYYMMDD` segue o dia do calendário local da liga (BRT), não o dia UTC de `events[].date`. Exemplos: a semifinal com kickoff `2026-05-21T00:00Z` responde em `dates=20260520`; a volta da final `2026-06-03T00:00Z` responde em `dates=20260602`; o jogo Vitória 1×0 Ceará (`2026-05-07T00:30Z`) responde em `dates=20260506`. Os curls da seção Reprodução usam a chave que devolve o evento, e o mando (`homeAway`) bate com o payload.

O recorte de contrato deste spike está em `api/src/providers/__fixtures__/espn-bra-copa-do-nordeste-scoreboard.json`, no mesmo estilo das fixtures de copa e da Série B presentes nesta branch: campos pesados removidos (`details`, `odds`, `broadcasts`, `links`, `statistics`) e eventos de dias diferentes reunidos num único scoreboard. A fixture guarda 1 jogo de `group-stage` (Group C), 2 quartas em jogo único, 1 semifinal com `leg` 1 e o par ida/volta da final (`finals`). O calendário da fixture replica as 4 entradas de fase ao vivo. O teste `api/src/providers/espnFixtures.test.ts` (bloco `fixture ESPN bra.copa_do_nordeste`) fixa os campos que sustentam o veredito.

## Slug e descoberta

| Caminho | Resultado observado |
| --- | --- |
| Catálogo `en` (`/v2/sports/soccer/leagues?limit=300`) | `copa_do_nordeste` ausente (`count=220`) |
| Catálogo `pt` (`…&lang=pt&region=br`) | `bra.copa_do_nordeste` listado (`count=32`) |
| Lookup direto `…/leagues/bra.copa_do_nordeste` | HTTP 200, `id=10951`, `name=Copa do Nordeste`, `season.year=2026` |
| Scoreboard `site.api` sem data e com `dates=` | HTTP 200, `leagues[0].slug=bra.copa_do_nordeste` |

A prova válida do slug é o scoreboard direto. Ausência no catálogo `en` não prova ausência no `site.api`.

## Contrato observado

| Requisito | Campo no payload | Comportamento observado |
| --- | --- | --- |
| Data e hora | `events[].date` | ISO 8601 em UTC |
| Mandante e visitante | `competitions[0].competitors[]` com `homeAway` | Dois competidores, `team.id` numérico estável e `team.displayName` |
| Placar | `competitors[].score` | String numérica em jogo encerrado |
| Jogo encerrado | `competitions[0].status.type` | `state=post`, `name=STATUS_FULL_TIME`, `detail=FT` nas amostras |
| Temporada / fase | `events[].season.slug` | Quatro valores: `group-stage`, `quarterfinals`, `semifinals`, `finals` |
| Grupo | `competitions[0].group` | Presente na fase de grupos (`Group A` a `D`, `groupId` numérico); ausente no mata-mata amostrado |
| Quartas | `leg` / `series` | Ausentes; classificado pelo `competitors[].winner` do jogo único |
| Semifinais | `leg` / `series` | Ida com `leg.value=1`, `series.title=Semifinals`, `totalCompetitions=2`, `completed=false` |
| Final | `leg` / `series` | Ida e volta com `finals`; na volta, `aggregateScore` em competitors e em `series.competitors`, `series.completed=true`, um `winner` na series |
| Agregado | `competitors[].aggregateScore` e `series.competitors[].aggregateScore` | Número na volta da final; ausente na ida |
| Disputa de pênaltis | `STATUS_FINAL_PEN` / `shootoutScore` | Não encontrada nas amostras de 2026 |
| Placeholder TBD / futuro | `state=pre` / `detail=TBD` | Não apareceu; temporada 2026 já encerrada na coleta |
| Calendário | `leagues[0].calendar` | `calendarType=list` com 4 entradas de fase (Group, Quarterfinals, Semifinals, Finals) |

Metadados de temporada no core (`seasons/2026/types`): `group-stage` (`hasLegs=false`, `hasGroups=true`), `quarterfinals` (`hasLegs=false`), `semifinals` (`hasLegs=true`), `finals` (`hasLegs=true`, `isFinal=true`). O scoreboard confirma quartas em jogo único e final em ida/volta. A semifinal expõe a ida com `series` aberta; a volta estruturada com `season.slug=semifinals` não apareceu na varredura densa de maio.

## Formato e type recomendado

As fases vêm fatiadas no `season.slug` (grupos + mata-mata). Pelo critério do lote, o type recomendado para cadastro futuro é `cup`. O calendário de fases (`calendarType=list`) acompanha o formato das copas já aprovadas nesta branch.

Formato verdadeiro observado no scoreboard:

- Grupos: pontos corridos por grupo, sem `leg`/`series`.
- Quartas: jogo único; `hasLegs=false` no metadado e ausência de `leg`/`series` nos eventos.
- Semifinais: metadado e ida apontam ida/volta (`hasLegs=true`, `totalCompetitions=2`); só a ida veio com `season.slug=semifinals`.
- Final: ida e volta completa com `finals`, agregado e classificado estruturados.

## Mapeamento atual do sync e fases novas

Lookup literal em `ESPN_STAGE_MAP` (`api/src/matches/espnSync.ts`): o mapa contém `group-stage`, `quarterfinals`, `semifinals` e `final` (singular). Não contém `finals` (plural). `resolveEspnStage` é fail-closed; slug fora do mapa e fora do padrão `YYYY-…` é descartado.

| Slug observado | Situação no mapa atual | Ação sugerida no ticket 08 |
| --- | --- | --- |
| `group-stage` | Já mapeado → `GROUP_STAGE` | Nenhuma |
| `quarterfinals` | Já mapeado → `QUARTER_FINALS` | Nenhuma |
| `semifinals` | Já mapeado → `SEMI_FINALS` | Nenhuma |
| `finals` | Ausente; o mapa tem só `final` | Mapear `finals` → `FINAL` (rótulo PT-BR da final) |

Este spike lista as fases para o ticket 08 e não implementa o parser.

## Veredito

| Competição | Slug | Tipo recomendado | Veredito |
| --- | --- | --- | --- |
| Copa do Nordeste | `bra.copa_do_nordeste` | `cup` | **GO** para o ticket futuro de parser (`finals`) e cadastro 2027 |

O endpoint responde com slug válido no scoreboard, placares encerrados, grupos, quartas em jogo único com `winner`, semifinal com `leg`/`series` na ida e final em ida/volta com agregado/classificado. O GO depende do ticket 08 acrescentar `finals` ao mapa; sem isso a final seria descartada. Este spike não registra a competição em produção.

## Lacunas conscientes

- Placeholder TBD e jogo futuro (`state=pre`) não entraram nas amostras porque a temporada 2026 já estava fechada. O comportamento TBD permanece o das outras fixtures ESPN (`isEspnPlaceholder`), sem prova nova neste slug.
- Disputa de pênaltis (`STATUS_FINAL_PEN`, `shootoutScore`) não apareceu na amostragem de grupos, quartas, semifinais e final de 2026. Há suporte estrutural no schema ESPN já usado pelas copas; falta evidência ao vivo neste slug.
- Volta das semifinais com `season.slug=semifinals`, `leg.value=2` e `series` fechada não foi encontrada na varredura densa de maio. Jogos em `dates=20260527` (kickoff `2026-05-28T00:30Z`) entre os mesmos pares da semifinal chegaram com `season.slug=group-stage` e sem `leg`/`series`; o core marca `seasonType` types/1 (Group Stage). O spike não trata esses eventos como volta estruturada de semifinal.
- Nomes seguem o padrão ESPN (`Sociedade Imperatriz de Desportos`, `Retró`, `Vitória`); revisão editorial/`TEAM_TRANSLATIONS` é opcional.
- A API segue sem documentação oficial nem SLA. Risco já aceito na ADR-018, mitigado por fixture + teste de contrato.

## Reprodução

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_nordeste/scoreboard"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_nordeste/scoreboard?dates=20260324"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_nordeste/scoreboard?dates=20260506"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_nordeste/scoreboard?dates=20260520"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_nordeste/scoreboard?dates=20260602"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_nordeste/scoreboard?dates=20260606"
curl -s "https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=300"
curl -s "https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=300&lang=pt&region=br"
curl -s "https://sports.core.api.espn.com/v2/sports/soccer/leagues/bra.copa_do_nordeste?lang=en&region=us"
```
