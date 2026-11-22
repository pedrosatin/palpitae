# Exclusão de conta e remoção de jogo

Dois procedimentos do operador que apagam dados, ambos por rota admin (ADR-026). Cada chamada roda numa transação do D1: ou tudo é gravado, ou nada.

Configure `PALPITAE_API_URL` e `PALPITAE_ADMIN_COOKIE` (`session=...`) sem versionar a sessão. As rotas respondem 403 para quem não é o admin de `ADMIN_EMAIL` (e `ADMIN_GOOGLE_SUB`, quando definido).

## Exclusão de conta a pedido do titular

O pedido chega por e-mail. A página `/privacidade` promete apagar os dados em até 30 dias.

### 1. Achar a conta

Confirme que o e-mail do pedido é o da conta. Leitura no D1, de `api/` e com `--config ./wrangler.toml`:

```sql
SELECT id, email, created_at FROM users WHERE lower(email) = lower('<e-mail do pedido>');
```

Grupos de que a conta é dona e quem fica com cada um:

```sql
SELECT g.id, g.name, g.deleted_at,
  (SELECT gm.user_id FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id <> g.owner_user_id
     AND NOT EXISTS (SELECT 1 FROM group_bans b WHERE b.group_id = gm.group_id AND b.user_id = gm.user_id)
   ORDER BY gm.joined_at, gm.user_id LIMIT 1) AS novo_dono
FROM groups g WHERE g.owner_user_id = '<id da conta>';
```

`novo_dono` nulo indica grupo que será apagado.

### 2. Excluir

```bash
curl --fail-with-body --request DELETE \
  "$PALPITAE_API_URL/admin/users/<id da conta>" \
  --cookie "$PALPITAE_ADMIN_COOKIE"
```

Resposta: `{ ok, transferred_groups: [{ group_id, new_owner_user_id }], deleted_groups: [id] }`.

O que acontece:

- Cada grupo de que a conta é dona, inclusive os excluídos, passa ao membro ativo de `joined_at` mais antigo, sem contar banidos nem a própria conta. No empate, vence o menor `user_id`. O papel `owner` em `group_members` acompanha a troca (migration 0045).
- Grupo sem outro membro ativo é apagado, com palpites, ranking e banimentos.
- A conta sai, e a cascata apaga perfil, participações, palpites, ranking, banimentos, palpites de chave e reservas de lembrete. As linhas de `payments` da conta, tabela sem uso, saem antes.
- A sessão da conta deixa de valer na requisição seguinte.

A rota recusa a conta do próprio admin (400) e conta inexistente (404). Uma segunda chamada com o mesmo id responde 404.

### 3. Conferir e responder

A consulta do passo 1 não devolve linhas. Responda ao titular confirmando a exclusão.

## Remoção de jogo duplicado

### 1. Conferir o duplicado

```sql
SELECT m.id, m.external_id, m.provider, m.start_time, m.status, m.home_score, m.away_score,
  (SELECT COUNT(*) FROM predictions p WHERE p.match_id = m.id) AS palpites
FROM matches m WHERE m.competition_id = '<id da competição>' AND m.home_team_id = '<mandante>' AND m.away_team_id = '<visitante>';
```

Os palpites do jogo removido saem com ele. Se o duplicado tem palpites que o original não tem, avalie antes se vale migrá-los. Se o provedor ainda manda o duplicado, o sync seguinte o grava de novo: confira a origem antes de remover.

### 2. Remover

```bash
curl --fail-with-body --request DELETE \
  "$PALPITAE_API_URL/admin/matches/<id do jogo>" \
  --cookie "$PALPITAE_ADMIN_COOKIE"
```

Resposta: `{ ok, match_id, competition_id, groups }`, com `groups` igual ao número de grupos não excluídos da competição.

Na mesma transação, o ranking desses grupos é refeito a partir dos palpites que sobram. Em fase eliminatória, o outro jogo do confronto (mesma fase, mando invertido) volta à fila de pontuação, e o poller refaz os pontos dele e o ranking no tick seguinte. O cache de `GET /matches` muda de chave pelo gatilho de exclusão da 0044.

Não apague jogo direto no D1: o ranking ficaria com os pontos dele.
