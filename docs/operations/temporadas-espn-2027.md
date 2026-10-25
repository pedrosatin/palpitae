# Preparação e abertura das competições ESPN em 2027

Este roteiro descreve a carga, a configuração, o piloto e a promoção das temporadas ESPN de 2027. Cada competição avança pelos portões de forma independente. Uma competição atrasada não segura as outras.

O documento registra critérios e evidência esperada. Ele não executa a abertura, não cadastra temporada, não altera cron e não promove competição. A execução operacional e a decisão de promote ficam com o admin, com relatório próprio por slug.

Competições do lote 1 já presentes em `ESPN_PRIMARY_COMPETITIONS` (`api/src/matches/espnSync.ts` em `main`):

| Competição | Código ESPN | `slugPrefix` (sem ano) | Slug após sync 2027 | `type` |
|---|---|---|---|---|
| Libertadores | `conmebol.libertadores` | `conmebol-libertadores` | `conmebol-libertadores-2027` | `cup` (default) |
| Sul-Americana | `conmebol.sudamericana` | `conmebol-sudamericana` | `conmebol-sudamericana-2027` | `cup` |
| Copa do Brasil | `bra.copa_do_brazil` | `copa-do-brasil` | `copa-do-brasil-2027` | `cup` |
| Brasileirão Série B | `bra.2` | `brasileirao-serie-b` | `brasileirao-serie-b-2027` | `league` |

Competições regionais com spike GO e parser em `main`, ainda fora de `ESPN_PRIMARY_COMPETITIONS` até o ticket de cadastro 2027 definir o `slugPrefix` e incluir o código no mapa:

| Competição | Código ESPN | `slugPrefix` | Slug 2027 | `type` (spike) |
|---|---|---|---|---|
| Paulista | `bra.camp.paulista` | a definir no cadastro | `${slugPrefix}-2027` | `cup` |
| Carioca | `bra.camp.carioca` | a definir no cadastro | `${slugPrefix}-2027` | `cup` |
| Mineiro | `bra.camp.mineiro` | a definir no cadastro | `${slugPrefix}-2027` | `cup` |
| Gaúcho | `bra.camp.gaucho` | a definir no cadastro | `${slugPrefix}-2027` | `cup` |
| Copa do Nordeste | `bra.copa_do_nordeste` | a definir no cadastro | `${slugPrefix}-2027` | `cup` |

## Formação do slug (`slugPrefix` sem ano)

O sync monta o slug da temporada com `${meta.slugPrefix}-${season}` em `upsertEspnCompetition` (`api/src/matches/espnSync.ts`). O `slugPrefix` na meta omite o ano. Incluir `2027` no prefixo geraria slug duplicado do tipo `…-2027-2027`.

Este roteiro não inventa `slugPrefix` para códigos ainda ausentes de `ESPN_PRIMARY_COMPETITIONS`. O prefixo entra no mapa de meta no ticket de cadastro, junto da inclusão do código ESPN.

## Relação com a execução operacional

Três frentes se complementam e não se substituem:

1. **Este roteiro** documenta portões, evidência esperada e comandos de conferência.
2. **Checklist operacional da abertura 2027** (tracker local `ops-validacao`, item de checklist da abertura) executa os portões quando o calendário e os eventos 2027 existirem.
3. **Abertura das temporadas ESPN 2027** (tracker local `novos-campeonatos`, item de temporada 2027) cobre cadastro, sync contínuo, radar e promote um a um no produto.

Caminhos relativos a `.scratch/` não resolvem no GitHub público. Por isso este documento traduz esses trabalhos em portões estáveis acima e cita os trackers só como referência local do operador.

Ligas football-data (lotes 2 e 3) seguem `docs/operations/promocao-lote2.md`.

## Conferência da fonte (estado observado)

Uma temporada 2027 só nasce quando o sync encontra ao menos um evento válido com `event.season.year = 2027`. Retorno vazio, evento sem ano ou de outra edição não cadastra temporada, time ou jogo. `ok: true` com contadores zerados significa que nada foi importado. O parâmetro `dates=` da URL não substitui o ano explícito do evento.

### Coleta de 17/10/2026 (lote 1)

Consultas de `scoreboard?dates=20270201` retornaram HTTP 200, `leagues[0].season.year = 2026` e `events = []` nas quatro fontes do lote 1. Isso descreve a data consultada e não prova ausência em todo o ano.

Fontes:

- [Libertadores em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard?dates=20270201)
- [Copa do Brasil em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=20270201)
- [Sul-Americana em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.sudamericana/scoreboard?dates=20270201)
- [Série B em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=20270201)

### Coleta de 2026-10-25 ~00:18 UTC (Série B + cinco regionais)

Seis probes serializadas (uma data inicial plausível por código, intervalo ≥1,3 s entre inícios) responderam HTTP 200 com `events = []`. Meta de liga e calendários flat ainda apontavam 2026. Nenhuma consulta trouxe evento com `season.year = 2027`. Uma data vazia por fonte não prova ausência em todas as datas de 2027; o calendário ainda 100% 2026 reforça que a edição não estava publicada nessas fontes na coleta.

| Código | Data probe | HTTP | Eventos | Meta / calendário |
|---|---|---|---|---|
| `bra.2` | 20270320 | 200 | 0 | year 2026 / calendário 2026 |
| `bra.camp.paulista` | 20270115 | 200 | 0 | year 2026 / calendário 2026 |
| `bra.camp.carioca` | 20270111 | 200 | 0 | year 2026 / calendário 2026 |
| `bra.camp.mineiro` | 20270110 | 200 | 0 | year 2026 / calendário 2026 |
| `bra.camp.gaucho` | 20270110 | 200 | 0 | year 2026 / calendário 2026 |
| `bra.copa_do_nordeste` | 20270324 | 200 | 0 | year 2026 / sem datas 2027 |

Datas sugeridas de reconferência (não agendadas por este documento): estaduais em 11/11/2026; Série B, Nordeste e nova passagem estadual em 01/12/2026. São pontos de consulta, não promessa de publicação.

## Portão operacional do cron (Gate07)

Separado dos portões 1 a 5 de cada competição. Sem este portão fechado, não se abre carga permanente nem validação remota contínua das temporadas 2027.

Evidência esperada:

1. Discovery natural das 06:00 UTC observada após o deploy de pacing, com as competições ESPN remotas esperadas.
2. Workers Logs legíveis no escopo do poller/discovery (campos de pacing, 403/timeout).
3. Contagem remota coerente com o mapa de primárias ESPN em produção.

Estado observado em coletas locais de 24 e 25/10/2026 (Analytics Engine + D1 remoto, sem dispatch de cron):

- Discovery pós-pacing ainda futura na coleta (~00:18 UTC); próxima janela natural 25/10/2026 06:00 UTC.
- Consulta a Workers Logs retornou 403 de autenticação/escopo na API da Cloudflare; ausência de linhas de erro no Analytics Engine não prova zero HTTP 403 da ESPN.
- D1 remoto: 4 competições ESPN ativas (`conmebol.libertadores`, `conmebol.sudamericana`, `bra.copa_do_brazil`, `bra.2`). As demais medidas locais de piloto/cadastro 2027 não entram como primárias remotas até o cadastro.

Este portão permanece **aberto**. Este roteiro não o declara fechado.

## Critérios de go/no-go (portões 1 a 5)

Cada portão libera o passo seguinte. Faltando item: no-go, corrigir ou remarcar consulta. O admin registra a evidência no relatório da abertura antes de avançar. Nenhum portão abaixo está declarado fechado para 2027 neste documento.

### Portão 1. Fonte publicada (libera a carga)

Evidência esperada:

1. Scoreboard ESPN de ao menos uma data da primeira fase com eventos `event.season.year = 2027`.
2. Dois times identificados (sem TBD), horário e fase conhecida em `ESPN_STAGE_MAP` / `resolveEspnStage` (`api/src/matches/espnSync.ts`).
3. Copas de ida e volta: `competitions[0].leg` quando a fase exige.
4. Nordeste: se reaparecer o padrão de volta com `season.slug=group-stage` sem `leg`/`series` (proxy 2026: eventos `401871835` / `401871836`), registrar a limitação. O parser não corrige fase por ID de evento, texto de nota ou heurística de data.

### Portão 2. Carga íntegra (libera o piloto)

Com sessão do admin, um pedido por competição em `POST /matches/sync`. Datas `YYYYMMDD` confirmadas na fonte. `PALPITAE_SYNC_BODY` aponta para um JSON preparado; substitua a data antes do envio:

```json
{
  "competition": "conmebol.libertadores",
  "season": 2027,
  "dates": ["DATA_CONFIRMADA_YYYYMMDD"]
}
```

```bash
curl --fail-with-body --request POST "$PALPITAE_API_URL/matches/sync" \
  --cookie "$PALPITAE_ADMIN_COOKIE" \
  --header 'Content-Type: application/json' \
  --data-binary "@$PALPITAE_SYNC_BODY"
```

Configure `PALPITAE_API_URL` para o ambiente de validação e `PALPITAE_ADMIN_COOKIE` como `session=...`, sem gravar a sessão em arquivos versionados. Produção exige operação administrativa separada. O endpoint exige `ADMIN_EMAIL`; a ESPN dispensa `FOOTBALL_API_KEY`.

Evidência esperada:

1. Temporada `${slugPrefix}-2027` com `visibility = pilot`, `status = upcoming`.
2. Segunda chamada idêntica: contagens no D1 estáveis (idempotência). `synced.matches` conta jogos processados naquela chamada, inclusive atualizações.
3. Zero jogos de 2026 na temporada 2027; zero times TBD.
4. Fases e rótulos coerentes com `api/src/matches/rounds.ts`.

A carga cria `penalty_phases = []` no nascimento. Copas nascem com `type = cup`; a Série B nasce com `type = league` (`meta.type`). O sync preserva status, visibilidade e fases já configuradas ao atualizar temporada existente.

Códigos regionais só entram neste portão depois de constarem em `ESPN_PRIMARY_COMPETITIONS` com `slugPrefix` definido. Este roteiro não cadastra esses códigos.

### Portão 3. Regulamento configurado (libera grupos de piloto com pênaltis)

Evidência esperada:

1. REC 2027 oficial da competição consultado na fonte (CONMEBOL, CBF ou federação estadual), com link no relatório.
2. `penalty_phases` preenchido só com as fases que o REC decide nos pênaltis.
3. Nascimento permanece `[]` até essa conferência. Não copiar 2026.

Valem para **todas** as competições deste roteiro, inclusive a Série B. O tipo `league` não autoriza afirmar ausência de pênaltis. O calendário CBF 2027 cita playoffs de acesso da Série B; se o REC 2027 confirmar fases de pênaltis nesses playoffs, liste apenas essas fases. Se o REC não publicar fases de pênaltis, mantenha `[]`.

Não existe endpoint de edição de `penalty_phases`. Atualização D1 deve selecionar exatamente um slug e temporada e manter `visibility = pilot` durante a validação:

```sql
UPDATE competitions
SET penalty_phases = '<JSON_DAS_FASES_CONFIRMADAS>'
WHERE slug = '<SLUG_DA_COMPETICAO_2027>' AND season = '2027' AND visibility = 'pilot';
```

Conferência local (a partir de `api/`):

```bash
npx wrangler d1 execute palpitae --local --command \
  "SELECT slug, external_id, provider, season, status, type, visibility, penalty_phases FROM competitions WHERE season = '2027' ORDER BY slug"
npx wrangler d1 execute palpitae --local --command \
  "SELECT c.slug, COUNT(m.id) AS jogos FROM competitions c LEFT JOIN matches m ON m.competition_id = c.id WHERE c.season = '2027' GROUP BY c.slug"
```

Calendário CBF, licenciamento FPF ou notícia de acesso **não** substituem o REC de disputa para este portão.

### Portão 4. Piloto validado (libera a promoção)

Evidência esperada:

1. Grupo fechado do admin / `PILOT_EMAILS` com palpites na primeira rodada real.
2. Ao menos uma rodada encerrada com placares do poller e pontos no ranking iguais ao cálculo manual.
3. Copas: se a primeira fase eliminatória for ida e volta, validar ponto de classificado; senão registrar adiamento explícito e decidir se promove antes dessa validação.
4. Usuário comum ainda não enxerga a competição.
5. Tabelas (quando elegíveis), ver seção "Tabelas regionais" abaixo.

O radar marca competição cadastrada como suportada mesmo com zero grupos; esse indicador não comprova temporada 2027 disponível nem liberação pública.

O cron diário das 06h UTC inclui temporadas `upcoming` e `ongoing` de provider ESPN; temporadas `finished` ficam fora da descoberta. O poller de 30 minutos acompanha jogos na janela ativa e no resgate. Nenhum desses processos muda a visibilidade.

### Portão 5. Promoção (decisão do admin)

Evidência esperada:

1. `POST /competitions/:id/promote` (o parâmetro aceita id ou slug) para um slug por vez.
2. `GET /competitions` com usuário comum mostra a competição promovida.
3. Relatório atualizado com data e responsável.

```bash
curl --fail-with-body --request POST \
  "$PALPITAE_API_URL/competitions/$PALPITAE_SLUG_CONFIRMADO/promote" \
  --cookie "$PALPITAE_ADMIN_COOKIE"
```

O endpoint é decisão administrativa explícita e **não** confere calendário, conclusão do piloto ou data de abertura. A conferência dos portões 1 a 4 é pré-requisito do admin.

## Tabelas regionais (StandingsTab)

Allowlist de cups com aba Tabela (`STANDINGS_ELIGIBLE_CUP_CODES` em `web/src/components/StandingsTab/StandingsTab.tsx`):

- `bra.camp.paulista`
- `bra.camp.carioca`
- `bra.camp.gaucho`

Comportamento de ranking geral aprovado:

- Carioca: fase `TACA_GUANABARA` colapsa em ranking geral, com nota de grupos ESPN incompletos.
- Gaúcho: fase `GROUP_STAGE` colapsa em ranking geral por `competition_code = bra.camp.gaucho`, com a mesma nota.

Mineiro (`bra.camp.mineiro`) e Copa do Nordeste (`bra.copa_do_nordeste`) estão fora dessa allowlist. O Portão 4/5 dessas competições **não** exige inclusão na Tabela antes do promote. Incluir na allowlist é decisão de produto separada; este roteiro não a impõe.

Série B usa classificação de liga em `REGULAR_SEASON`. Paulista usa `LEAGUE_PHASE` na allowlist.

## Limitação conhecida da Copa do Nordeste (feed 2026)

Na coleta proxy de 2026, candidatos de volta de semifinal `401871835` e `401871836` (`dates=20260527`) chegaram com `season.slug=group-stage`, grupos C/D e sem `leg`/`series`. O sync canônico os importa como `GROUP_STAGE` com `leg=null`. O parser não corrige fase por ID de evento, texto de nota ou heurística de data. Se o padrão se repetir em 2027, a carga administrativa reconfirma o feed na fonte e registra o tratamento ou a limitação antes de configurar `penalty_phases` e promover o slug. Detalhe do spike: `docs/architecture/spike-espn-copa-do-nordeste.md`.

## Tabela de acompanhamento por competição

Colunas = portões. Células descrevem a evidência esperada. Status live de 2027 fica de fora desta tabela. Na data deste documento, Portão 1 permanece sem evento `season.year = 2027` nas datas consultadas; Gate07 permanece aberto.

### Lote 1 (já em `ESPN_PRIMARY_COMPETITIONS`)

| Código | Gate07 (cron) | 1 Fonte | 2 Carga | 3 Regulamento | 4 Piloto | 5 Promoção |
|---|---|---|---|---|---|---|
| `conmebol.libertadores` | Discovery 06 UTC pós-pacing + logs legíveis | ≥1 evento 2027 com times, fase e `leg` se ida/volta | Sync `season=2027` → `conmebol-libertadores-2027` pilot; 2ª chamada estável | REC CONMEBOL 2027 → `penalty_phases`; nasce `[]` | Grupo fechado; placar/pontos; classificado se ida/volta | `POST …/promote` + visível a usuário comum |
| `conmebol.sudamericana` | Idem | Idem | Sync → `conmebol-sudamericana-2027` | REC CONMEBOL 2027 → fases de pênaltis | Idem | Idem, slug próprio |
| `bra.copa_do_brazil` | Idem | Idem | Sync → `copa-do-brasil-2027` | REC CBF 2027 → fases de pênaltis | Idem | Idem, slug próprio |
| `bra.2` | Idem | ≥1 evento 2027 Série B | Sync → `brasileirao-serie-b-2027` (`type=league`) | REC CBF 2027; playoffs só se o REC listar pênaltis; senão `[]` | Grupo fechado; tabela `REGULAR_SEASON` | Idem, slug próprio |

### Regionais (cadastro 2027 ainda pendente do mapa de meta)

| Código | Gate07 (cron) | 1 Fonte | 2 Carga | 3 Regulamento | 4 Piloto / Tabela | 5 Promoção |
|---|---|---|---|---|---|---|
| `bra.camp.paulista` | Mesmo Gate07 do lote | ≥1 evento 2027 | Entrar em `ESPN_PRIMARY` com `slugPrefix` sem ano; sync → `${slugPrefix}-2027` | REC FPF 2027; nasce `[]` | Allowlist Tabela; `LEAGUE_PHASE` | Promote opcional após piloto |
| `bra.camp.carioca` | Idem | ≥1 evento 2027 | Idem | REC FERJ 2027; nasce `[]` | Allowlist; ranking geral `TACA_GUANABARA` + nota | Idem |
| `bra.camp.gaucho` | Idem | ≥1 evento 2027 | Idem | REC FGF 2027; nasce `[]` | Allowlist; ranking geral `GROUP_STAGE` + nota | Idem |
| `bra.camp.mineiro` | Idem | ≥1 evento 2027 | Idem | REC FMF 2027; nasce `[]` | Fora da allowlist Tabela; não exigir inclusão para promote | Idem |
| `bra.copa_do_nordeste` | Idem | ≥1 evento 2027; registrar gap `group-stage` se voltar | Idem | REC CBF Nordeste 2027; nasce `[]` | Fora da allowlist Tabela; gap canônico sem heurística | Idem |

## Pendências conscientes

- Calendários e fixtures ESPN 2027 confirmados por evento (`season.year = 2027`).
- Gate07 remoto (discovery pós-pacing + Workers Logs com escopo suficiente).
- Inclusão dos códigos regionais em `ESPN_PRIMARY_COMPETITIONS` com `slugPrefix` explícito, sem ano no prefixo.
- REC 2027 por competição antes de qualquer `penalty_phases` diferente de `[]`.
- Carga real, piloto e promote individual, cada um com relatório.

Esta preparação não executa essas operações e não altera produção.
