# Promoção das competições do lote 2

La Liga, Serie A, Bundesliga, Primeira Liga e Brasileirão Série B já estão seedadas como `visibility = pilot` (temporada 2026). O radar as marca como suportadas assim que o cadastro existe. A liberação pública é só por promote administrativo, um slug por vez. Não há promoção automática.

| Competição | Código | Provider | Slug |
|---|---|---|---|
| La Liga | `PD` | football-data | `la-liga-2026` |
| Serie A | `SA` | football-data | `serie-a-2026` |
| Bundesliga | `BL1` | football-data | `bundesliga-2026` |
| Primeira Liga | `PPL` | football-data | `primeira-liga-2026` |
| Brasileirão Série B | `bra.2` | espn | `brasileirao-serie-b-2026` |

## Pré-condições (antes de cada promote)

Confirme para o slug escolhido:

1. Sync recente sem falha (jogos e times coerentes com a fonte).
2. Grupo piloto validado: palpites, placares e pontuação batem com o regulamento.
3. Sem TBD estrutural (times, fases ou confrontos pendentes que quebrem a experiência pública).
4. `visibility` ainda é `pilot` no D1.

O endpoint `POST /competitions/:slug/promote` não verifica calendário, sync nem conclusão do piloto. A decisão é do admin.

## Promote (um slug por vez)

Configure `PALPITAE_API_URL` e `PALPITAE_ADMIN_COOKIE` (`session=...`) sem versionar a sessão. Produção exige operação administrativa separada.

```bash
export PALPITAE_SLUG_CONFIRMADO=la-liga-2026

curl --fail-with-body --request POST \
  "$PALPITAE_API_URL/competitions/$PALPITAE_SLUG_CONFIRMADO/promote" \
  --cookie "$PALPITAE_ADMIN_COOKIE"
```

Repita trocando `PALPITAE_SLUG_CONFIRMADO` por cada slug da tabela, só depois das pré-condições daquele slug. Não promova em lote.

## Verificação pós-promote

Com sessão de usuário comum (sem `ADMIN_EMAIL` nem `PILOT_EMAILS`):

```bash
curl --fail-with-body --request GET \
  "$PALPITAE_API_URL/competitions" \
  --cookie "$PALPITAE_ORDINARY_COOKIE"
```

A resposta deve incluir apenas o slug acabado de promover entre os do lote 2 (além das competições já públicas). Os demais do lote 2 continuam ausentes até o promote respectivo. A promoção altera só `visibility`; status temporal e provider permanecem iguais.
