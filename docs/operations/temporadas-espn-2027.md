# Preparação e abertura das competições ESPN em 2027

Libertadores, Copa do Brasil, Sul-Americana e Brasileirão Série B usam o mesmo pipeline ESPN. Cada nova temporada só é cadastrada quando o sync encontra ao menos um evento válido com `event.season.year = 2027`. Um retorno vazio, um evento sem ano ou de outra edição não cadastra temporada, time ou jogo. `ok: true` com contadores zerados significa que nada foi importado.

Em 17/10/2026, consultas de `scoreboard?dates=20270201` retornaram HTTP 200, `leagues[0].season.year = 2026` e `events = []` nas fontes ESPN consultadas. Isso descreve apenas a data consultada e não comprova ausência de calendário em todo o ano. A abertura de 2027 e o encerramento do piloto de 2026 continuam pendentes.

Fontes consultadas:

- [Libertadores em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard?dates=20270201)
- [Copa do Brasil em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=20270201)
- [Sul-Americana em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.sudamericana/scoreboard?dates=20270201)
- [Série B em 01/02/2027](https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=20270201)

## Conferência da fonte e carga administrativa

O admin deve confirmar o calendário e o regulamento de cada competição antes da primeira rodada. Para cada data publicada, confira o ano de cada evento, fase, times identificados, horário e vínculo de ida/volta, conforme o [contrato validado da ESPN](../architecture/spike-espn-novos-campeonatos.md). Datas consultadas não substituem o ano explícito dos eventos. Os dados sintéticos dos testes não comprovam disponibilidade real de 2027.

| Competição | Código ESPN | Slug esperado |
|---|---|---|
| Libertadores | `conmebol.libertadores` | `conmebol-libertadores-2027` |
| Copa do Brasil | `bra.copa_do_brazil` | `copa-do-brasil-2027` |
| Sul-Americana | `conmebol.sudamericana` | `conmebol-sudamericana-2027` |
| Brasileirão Série B | `bra.2` | `brasileirao-serie-b-2027` |

Com uma sessão do admin, envie um pedido por competição para `POST /matches/sync`. Use datas `YYYYMMDD` confirmadas na fonte. No exemplo, `PALPITAE_SYNC_BODY` deve apontar para um JSON preparado com o formato abaixo, substituindo `DATA_CONFIRMADA_YYYYMMDD` antes do envio:

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

Configure `PALPITAE_API_URL` para o ambiente de validação e `PALPITAE_ADMIN_COOKIE` como `session=...`, sem registrar a sessão em arquivos versionados. Produção exige uma operação administrativa separada. O endpoint exige `ADMIN_EMAIL`, e a ESPN dispensa `FOOTBALL_API_KEY`.

A carga cria `status = upcoming`, `visibility = pilot` e fases de pênaltis vazias. Copas nascem com `type = cup`; a Série B nasce com `type = league` (`meta.type` em `espnSync.ts`). Repita o mesmo pedido e confira que as contagens persistidas não aumentaram. `synced.matches` conta jogos processados naquela chamada, inclusive atualizações.

## Configuração e validação do piloto

Depois da primeira carga válida, confira o cadastro e os jogos no D1. Estes comandos partem de `api/` e consultam o ambiente local:

```bash
npx wrangler d1 execute palpitae --local --command "SELECT slug, external_id, provider, season, status, type, visibility, penalty_phases FROM competitions WHERE season = '2027' ORDER BY slug"
npx wrangler d1 execute palpitae --local --command "SELECT c.slug, COUNT(m.id) AS jogos FROM competitions c LEFT JOIN matches m ON m.competition_id = c.id WHERE c.season = '2027' GROUP BY c.slug"
```

O cadastro inicial deixa `penalty_phases = []`. O admin precisa configurar as fases permitidas conforme o regulamento confirmado de 2027. Não copie automaticamente o regulamento de 2026. O mapa de fases aceitas está em `api/src/matches/espnSync.ts`; fase desconhecida é descartada. Não existe endpoint de edição dessa configuração. Uma atualização D1 deve selecionar exatamente um slug e temporada e manter `visibility = pilot` durante a validação.

### Limitação conhecida da Copa do Nordeste (feed 2026)

Na coleta proxy de 2026, candidatos de volta de semifinal `401871835` e `401871836` (`dates=20260527`) chegaram com `season.slug=group-stage`, grupos C/D e sem `leg`/`series`. O sync canônico os importa como `GROUP_STAGE` com `leg=null`. O parser não corrige fase por ID de evento, texto de nota ou heurística de data. Se o padrão se repetir em 2027, a carga administrativa deve reconfirmar o feed na fonte e registrar o tratamento ou a limitação antes de configurar `penalty_phases` e promover o slug.

Exemplo de formato SQL, a preencher e revisar antes de executar em arquivo próprio:

```sql
UPDATE competitions
SET penalty_phases = '<JSON_DAS_FASES_CONFIRMADAS>'
WHERE slug = '<SLUG_DA_COMPETICAO_2027>' AND season = '2027' AND visibility = 'pilot';
```

Confira `penalty_phases` após a atualização e teste os casos do regulamento no grupo fechado antes da promoção. O cron diário das 06h UTC inclui temporadas `upcoming` e `ongoing` de provider ESPN; temporadas `finished` ficam fora da descoberta. O poller de 30 minutos acompanha jogos na janela ativa e no resgate. Nenhum desses processos muda a visibilidade. O sync preserva status, visibilidade e fases configuradas ao atualizar uma temporada existente.

O admin e os endereços de `PILOT_EMAILS` devem conseguir consultar a temporada e seus jogos. Usuários comuns devem continuar sem acesso. Valide jogos, horários, palpites, placares e pontuação do confronto no grupo fechado. O radar marca a competição cadastrada como suportada mesmo com zero grupos; esse indicador não comprova temporada 2027 disponível nem liberação pública.

## Promoção individual

Somente após concluir a validação de cada competição e o piloto, o admin escolhe um slug e chama `POST /competitions/:slug/promote`. O endpoint é uma decisão administrativa explícita e não verifica calendário, conclusão do piloto ou data de abertura. Portanto, esses critérios precisam ser conferidos antes do pedido.

```bash
curl --fail-with-body --request POST \
  "$PALPITAE_API_URL/competitions/$PALPITAE_SLUG_CONFIRMADO/promote" \
  --cookie "$PALPITAE_ADMIN_COOKIE"
```

Confira que `GET /competitions` com a sessão de um usuário comum mostra apenas a competição promovida, entre as quatro de 2027. Repita a decisão separadamente para as demais. A promoção altera apenas `visibility`; o status temporal continua sob manutenção administrativa.

Permanecem pendentes os calendários e fixtures de 2027 confirmados, a carga real antes da primeira rodada, a configuração dos regulamentos, a validação e conclusão dos pilotos e a promoção individual pelo admin. Esta preparação não executa essas operações e não altera produção.
