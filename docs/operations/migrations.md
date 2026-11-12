# Migrations do D1: expand/contract

O workflow `.github/workflows/deploy-api.yml` aplica as migrations no D1 de produção e só depois publica o Worker. Se a publicação falhar, ou se o workflow for cancelado entre os dois passos, o Worker anterior continua no ar lendo o schema novo. Por isso toda migration precisa manter o Worker que está em produção funcionando.

## Regra

Toda mudança de schema é de uma destas duas fases:

- **Expand.** Acrescenta sem tirar nada: `ADD COLUMN` anulável ou com `DEFAULT`, tabela nova, índice não único, trigger que não recusa valor, backfill com `UPDATE`. O Worker anterior ignora o que não conhece. Pode ir no mesmo deploy do código que passa a usar o acréscimo.
- **Contract.** Remove ou renomeia algo que já existia: `DROP COLUMN`, `RENAME COLUMN`, `DROP TABLE`, `DROP VIEW`, `ALTER TABLE ... RENAME TO`, `DROP INDEX` ou índice `UNIQUE` novo que afete o que o Worker anterior grava, ou um trigger novo que recusa um valor que o Worker anterior ainda grava. Um `DROP INDEX` de índice único quebra o `ON CONFLICT` que dependa dele, e um `UNIQUE` novo recusa linhas que o Worker anterior ainda insere (o índice da 0040, por exemplo, recusa uma segunda competição com o mesmo provedor, id externo e temporada). Só pode entrar num deploy posterior ao que tirou do código toda leitura e escrita do que será removido. Assim, o Worker que fica no ar se a publicação falhar já não depende do que a migration remove.

A migration de contract traz uma linha que diz por que a remoção é segura:

```sql
-- contract: users.user_name sem leitura nem escrita desde o deploy de <commit ou PR>
```

`api/src/migrationCompat.test.ts` falha quando uma migration faz `DROP COLUMN`, `RENAME COLUMN`, `DROP TABLE`, `DROP VIEW` ou `RENAME TO` sem essa linha. `DROP INDEX` e índice `UNIQUE` novo ficam para a revisão da PR, porque a 0034 apaga com segurança um índice não único coberto por outro mais largo. O teste também não confere se o motivo é verdadeiro. Quem revisa a PR confere que o deploy citado já está em produção.

Outras restrições do D1:

- Sem rebuild de tabela (criar cópia, copiar dados, apagar a original). Ver ADR-013.
- O SQLite recusa `DROP COLUMN` em coluna com índice, `UNIQUE`, chave primária, chave estrangeira ou citada por trigger. Apague o índice ou o trigger antes, na mesma migration de contract.

## Exemplo: renomear uma coluna em dois deploys

Exemplo hipotético: trocar `users.user_name` por `users.display_name`. `RENAME COLUMN` direto quebraria o Worker anterior no intervalo entre a migration e a publicação, porque ele ainda consulta `user_name`.

### Deploy 1 (expand)

Migration:

```sql
ALTER TABLE users ADD COLUMN display_name TEXT;
UPDATE users SET display_name = user_name WHERE display_name IS NULL;

-- Enquanto o Worker anterior estiver no ar, o que ele gravar em user_name
-- também chega em display_name.
CREATE TRIGGER users_user_name_insert AFTER INSERT ON users
WHEN NEW.display_name IS NULL AND NEW.user_name IS NOT NULL
BEGIN
  UPDATE users SET display_name = NEW.user_name WHERE id = NEW.id;
END;

CREATE TRIGGER users_user_name_update AFTER UPDATE OF user_name ON users
BEGIN
  UPDATE users SET display_name = NEW.user_name WHERE id = NEW.id;
END;
```

Código do Worker no mesmo deploy: lê e grava só `display_name`. Nenhuma consulta cita mais `user_name`.

Se a publicação falhar, o Worker anterior segue lendo e gravando `user_name`, e os triggers copiam cada escrita para `display_name`. Quando a publicação der certo, o Worker novo encontra `display_name` completo.

### Deploy 2 (contract)

Só depois que o Worker do deploy 1 estiver em produção:

```sql
-- contract: users.user_name sem leitura nem escrita desde o deploy 1 (<commit ou PR>)
DROP TRIGGER IF EXISTS users_user_name_insert;
DROP TRIGGER IF EXISTS users_user_name_update;
ALTER TABLE users DROP COLUMN user_name;
```

Se a publicação do deploy 2 falhar, quem fica no ar é o Worker do deploy 1, que já não usa `user_name`.

### Rollback

- Se o código do deploy 1 for revertido antes do deploy 2, o Worker volta a ler `user_name`. O que o Worker do deploy 1 gravou ficou só em `display_name`: quem trocou de nome depois do deploy 1 aparece com o nome antigo, e quem entrou depois dele aparece sem nome.
- Depois do deploy 2, o Worker anterior ao deploy 1 não funciona mais: a coluna não existe. O `git revert` do deploy 2 não recria a coluna. Para voltar, escreva uma migration nova de expand que recrie `user_name` e copie os dados de `display_name`.

## Rodar migrations à mão

Os comandos rodam de `api/` e sempre com `--config ./wrangler.toml`. Sem essa opção, o wrangler acha primeiro o `wrangler.jsonc` da raiz (projeto do Pages) e não encontra as migrations.

```bash
cd api
npx wrangler d1 migrations create palpitae <descricao> --config ./wrangler.toml
npx wrangler d1 migrations apply palpitae --local --config ./wrangler.toml
npx wrangler d1 migrations list palpitae --remote --config ./wrangler.toml
```

A aplicação em produção é do workflow de deploy. Rode `apply --remote` à mão só com autorização do operador.
