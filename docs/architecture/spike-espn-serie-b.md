# Spike ESPN como fonte do Brasileirão Série B

## Objetivo

Este documento registra o resultado do spike que avaliou a API pública da ESPN como fonte de confrontos para o Brasileirão Série B (`bra.2`). A ADR-018 libera a ESPN como provider primário em competições fora do free tier do football-data.org, condicionada a um spike de entrada. O lote 1 já aprovou Libertadores, Sul-Americana e Copa do Brasil em `docs/architecture/spike-espn-novos-campeonatos.md`. Este relatório fecha o gate da Série B para o ticket de cadastro piloto (ticket 06 do lote 2). Este spike não altera comportamento de produção: nenhum provider novo entra no sync, a competição não nasce no banco e `ESPN_PRIMARY_COMPETITIONS` permanece intacto.

## Método

A coleta consultou a API ao vivo em 19 de outubro de 2026, sem autenticação, pelo endpoint `GET https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=YYYYMMDD`. A pesquisa leu o calendário plano da temporada (141 datas), amostragem densa a cada ~10 dias e scoreboards pontuais com jogos encerrados, futuros e placeholders TBD. O JSON bruto ficou em `~/.cache/palpitae-lote2-research/` (`bra_2_*.json`). O resumo da pesquisa fica no scratch local do operador (não versionado nesta PR).

O recorte de contrato deste spike está em `api/src/providers/__fixtures__/espn-bra-2-scoreboard.json`, no mesmo estilo das fixtures de copa: campos pesados removidos (`details`, `odds`, `broadcasts`, `links`, `statistics`) e eventos de dias diferentes reunidos num único scoreboard. A fixture guarda 4 jogos encerrados (`20260412`, `20261018`), 1 jogo futuro com times reais (`20261101`) e 1 placeholder TBD (`20261128`). O calendário da fixture é uma amostra de 13 datas ISO (início, meio de outubro e fim), truncada dos 141 dias ao vivo. Isso basta para provar o formato plano de datas, distinto das entradas de fase das copas. O teste `api/src/providers/espnFixtures.test.ts` (bloco `fixture ESPN bra.2`) fixa os campos que sustentam o veredito.

## Contrato observado

| Requisito | Campo no payload | Comportamento observado |
| --- | --- | --- |
| Data e hora | `events[].date` | ISO 8601 em UTC, presente em encerrado, futuro e TBD |
| Mandante e visitante | `competitions[0].competitors[]` com `homeAway` | Dois competidores, `team.id` numérico estável e `team.displayName` |
| Placar | `competitors[].score` | String numérica em jogo encerrado; `"0"` em agendado/TBD |
| Jogo encerrado | `competitions[0].status.type` | `state=post`, `name=STATUS_FULL_TIME`, `detail=FT` |
| Temporada / fase | `events[].season.slug` | Sempre `2026-brasileiro-serie-b` (padrão `YYYY-…` de liga) |
| Rodada numérica | `events[].week` / `events[].matchday` | **Ausentes** no scoreboard ao vivo de `bra.2` |
| Ida/volta | `competitions[0].leg` / `series` | Ausentes (liga de pontos corridos, sem pernas de mata-mata) |
| Placeholder | `team.displayName` + `status.detail` | `TBD Home` / `TBD Away` e `detail=TBD` em 28/11; filtrável por `isEspnPlaceholder` |
| Calendário | `leagues[0].calendar` | Lista plana de datas ISO (`calendarType=day`), não entradas de fase |

A pesquisa não encontrou disputa de pênaltis nas amostras de liga, esperado em liga de pontos corridos sem mata-mata. O volume extrapolado (~376 jogos; 20 times × 38 rodadas = 380) confirma escala de liga completa. No football-data.org o código `BSB` é **TIER_THREE**, fora do free tier: a ESPN fica como fonte primária.

## Mapeamento já resolvido no sync (#546)

Antes deste spike, o parser `extractValidEvent` era fail-closed em `ESPN_STAGE_MAP` e descartaria `2026-brasileiro-serie-b`. A PR #546 (`feat(matches): aceita fases de liga no sync ESPN`) já ensinou o sync:

- `resolveEspnStage`: slug no padrão `YYYY-…` → `REGULAR_SEASON`
- `resolveEspnRound`: usa `week` / `matchday` quando existem; **senão grava `REGULAR_SEASON`**
- Placeholders TBD continuam descartados por `isEspnPlaceholder` (já coberto em `espnSync.test.ts` também com slug de liga)

No scoreboard ao vivo de `bra.2` não há `week` nem `matchday`. Portanto o sync grava `phase=REGULAR_SEASON` e `round=REGULAR_SEASON`. Isso é aceitável para o piloto: a UI de liga já agrupa por fase/rodada string, e inventar número de rodada a partir do nada quebraria o contrato. O ticket 06 **não deve** fabricar rodadas 1…38 a partir deste payload. Enriquecimento opcional de rodada (calendário editorial, outro endpoint) fica fora do escopo deste spike e do piloto inicial.

## Veredito

| Competição | Slug | Tipo | Veredito |
| --- | --- | --- | --- |
| Brasileirão Série B | `bra.2` | `league` | **GO** para o ticket 06 |

Pré-requisitos de parser já estão em `main` (#546). O ticket 06 pode cadastrar a competição como ESPN-primária (`provider='espn'`, `type='league'`), sem reabrir o spike de copas do lote 1. Este spike não registra a competição em produção.

## Lacunas conscientes para o ticket 06

- Descoberta histórica exige uma chamada por dia nas janelas do calendário plano (mesmo custo das copas; backfill separado do sync diário).
- Sem `week`/`matchday`, a rodada canônica no banco fica `REGULAR_SEASON` até haver fonte alternativa de número de rodada.
- Nomes seguem o padrão ESPN (`América Mineiro`, `Botafogo-SP`, `Athletic`); revisão editorial/`TEAM_TRANSLATIONS` é opcional e editorial.
- A API segue sem documentação oficial nem SLA. Risco já aceito na ADR-018, mitigado por fixture + teste de contrato.

## Reprodução

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=20260412"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=20261018"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=20261101"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=20261128"
```
