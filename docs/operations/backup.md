# Backup do D1 (R2 privado + age)

Cópia criptografada do banco D1 para um bucket R2 privado na mesma conta Cloudflare, com retenção definida e ensaio de restauração isolado. Este documento registra a comparação de opções, o processo, o runbook e o que ainda depende de configuração real do operador.

**Escopo desta fatia:** cobre erro operacional no D1 (migration ruim, `DELETE` acidental, dump corrompido) e retenção além da janela do Time Travel, com ciphertext age e identity offline. **Não cobre** perda da conta Cloudflare nem indisponibilidade prolongada da plataforma Cloudflare. Cópia fora da Cloudflare (ex.: B2) fica como evolução futura.

Pesquisa consultada em 2026-11-03 / 2026-11-20: [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/), [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/), [age](https://github.com/FiloSottile/age) **v1.2.1** (pinado no CI/workflow; não use a menção genérica “v1.3.x” como versão instalada), [Cloudflare D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 legacy backups](https://developers.cloudflare.com/d1/reference/backups/), exemplo [Workflows → R2](https://developers.cloudflare.com/workflows/examples/backup-d1/). Preços e limites mudam; confirme no painel antes de operar.

## O que este backup é e o que não é

| Mecanismo | Função | Independência |
|---|---|---|
| Este processo (`scripts/backup`) | Dump SQL do D1, gzip, criptografia age, objeto no sink local ou R2 | Mesma conta Cloudflare (R2); identity age offline; **não** cobre perda da conta/plataforma CF |
| D1 Time Travel | PITR nativo (7 dias no Free, 30 dias no Paid, conforme docs CF) | Mesma conta e infraestrutura Cloudflare |
| Export AE → R2 (`palpitae-events`) | Cold path de eventos de observabilidade em NDJSON | Arquivo de telemetria; cobre eventos AE, deixa de fora o estado do D1 de palpites/grupos |
| Failover multi-provedor / cópia fora da CF | Fora do escopo desta fatia (evolução futura, ex.: B2) | Não há troca automática de provedor nem segundo provedor nesta entrega |

Time Travel continua útil para erro operacional recente. Este processo estende retenção e exige identity age offline; a disponibilidade do ciphertext ainda depende da conta R2/Cloudflare.

## Decisão (20/11/2026)

Opção escolhida (menor custo e risco no plano grátis da Cloudflare, sem conta nova): **Cloudflare R2** na conta já usada pelo produto, dump criptografado com **age**, identity só com o operador, retenção **14 diários / 8 semanais / 12 mensais**, agendamento pretendido **semanal** (schedule comentado até medição do bloqueio do `d1 export --remote`).

Motivos:

- R2 free tier: **10 GB** de armazenamento, operações Class A/B no free, **egress zero** para a internet no modelo R2 — cabe um acervo pequeno de dumps cifrados.
- Bucket **privado dedicado** `palpitae-backups` na conta Cloudflare. O repositório é público: artefatos do GitHub Actions seriam baixáveis por qualquer um; mesmo cifrados, metadados e ciphertext não ficam em lugar público.
- Sem conta nova (B2 exigiria Backblaze). Sem Worker cron novo: o job roda no GitHub Actions e **não consome** o teto de subrequests dos crons do Worker (poller, lembretes, cold path AE→R2).
- Independência: menor que um segundo provedor (mesma conta CF). Mitigação nesta fatia: age com identity offline; Time Travel para erro operacional recente; bucket lock rules no R2 contra delete/overwrite prematuro. B2 (ou outro sink fora da CF) permanece evolução futura se a perda da conta CF for risco único inaceitável.
- Export AE→R2 (`palpitae-events`) **não** é backup do D1 — só telemetria.

### Comparativo resumido

| Opção | Custo (consulta) | Retenção prática | Segurança | Independência |
|---|---|---|---|---|
| **R2 + age (escolhida)** | Free tier R2 10 GB; $0 nesta fatia | 14/8/12 no mesmo sink | age v1.2.1; identity offline; bucket privado | Média (mesma conta CF; ciphertext portável) |
| B2 + age | 10 GB free B2; conta nova | 14/8/12 | age; outro provedor | Alta — evolução futura |
| Artefato GHA + age | Grátis 90 dias | ≤90 dias de artefato | age; artefato baixável no repo público | Baixa privacidade de superfície |
| Só Time Travel | Incluído no D1 | 7d Free / 30d Paid | Controle Cloudflare | Nenhuma cópia externa |
| Snapshot legacy `d1 backup` | Legacy | Histórico curto | Nativo CF | Não usar em DB production |

**Viabilidade free R2:** dump D1 de produto pequeno (MB a poucas dezenas de MB comprimidos) com ~34 objetos retidos tende a caber em 10 GB. Tamanho real do export remoto **não foi medido nesta entrega**. Bucket dedicado `palpitae-backups` é **obrigatório** (não reutilizar `palpitae-events` nem compartilhar prefixo com outro workload). Criar bucket/token/environment é passo do orquestrador — esta PR não cria recursos nem grava secrets.

## Artefatos no repositório

```
scripts/backup/
  backup.mjs              # valida dump + gate de contagens → gzip → age → sink local|r2
  daily.mjs               # pack + verify híbrido do objeto novo + retenção (fail-closed);
                          # nome histórico; a cadência pretendida do Actions é semanal
  restore.mjs             # download local|R2 + restore isolado + compare contagens seladas
  restore-rehearsal.mjs   # atalho local de restore.mjs
  prune.mjs               # retenção; --apply no R2 exige R2_PRUNE_*
  run-rehearsal.mjs       # ensaio ponta a ponta com dados sintéticos (local)
  retention.test.mjs      # naming / retenção / manifesto
  r2-sink.test.mjs        # cliente R2 + prune safety com R2 simulado
  backup-gates.test.mjs   # regressão de gates (dump/recipients/egress/cifra/…)
  fixtures/synthetic.sql  # dump falso, sem dados reais
  recipients.example      # template sem chave funcional (recusado como arquivo vivo)
  lib/                    # naming, retention, integrity, inventory, pipeline, recipients,
                          # verify-sqlite, sealed-meta, restore-proof, sinks, r2-client, prune-guard

.github/workflows/backup-d1.yml  # workflow_dispatch guardado; environment backup; só main; schedule comentado
.github/workflows/ci.yml         # job Backup (age + sqlite3) com PALPITAE_BACKUP_REQUIRE_AGE=1
```

Nenhum secret, identity age, token R2 ou dump de produção entra no git.

## Fluxo diário (implementado)

1. Materializar o dump (`--source=fixture|sql-file|d1-local|d1-remote`). O export remoto **bloqueia** outras queries no D1 enquanto roda (docs Cloudflare) e exige `--i-understand-remote-export`.
2. **Resolver baseline (fail closed):** se não houver `--baseline-counts` / `--source-counts` / bootstrap / fixture, o `daily.mjs` escolhe o objeto anterior mais novo **somente depois** de validar o manifesto + companions/hashes (sidecar selado + `.counts.json`). `.counts.json` modificado (SHA-256 ≠ manifesto) é recusado — não vira baseline.
3. **Validar o dump antes de cifrar:** importar em SQLite isolado; exigir `PRAGMA integrity_check` = `ok` e `PRAGMA foreign_key_check` sem linhas (com `foreign_keys=ON` após o import); exigir o schema essencial (`users`, `competitions`, `teams`, `matches`, `groups`, `predictions`); se o baseline/public counts trouxer `tables`, exigir essas tabelas também (detecta perda de tabelas, ex.: dump cortado após `predictions` sem `leaderboard`); registrar `COUNT(*)` por tabela essencial e aplicar o **gate de contagens**. Dump vazio, truncado em fronteira SQL, schema-only sem evidência, violações de FK/integridade, ou queda catastrófica a zero frente a baseline falha fechado. Com `--source-counts`, a comparação é exata. **O modo baseline não detecta truncamento parcial** que deixa COUNTs > 0 — isso não é fingido no código. Sem baseline/source: falha fechado, salvo `--source=fixture` ou o primeiro pack real com `--bootstrap-with-evidence=@arquivo`.
4. Empacotar com `backup.mjs` ou `daily.mjs` (`gzip` → `age` → `sink.put` do ciphertext, do manifesto público **sem** `rowCounts` em claro, do sidecar cifrado `.meta.json.age` com COUNTs exatos, e do companion público `.counts.json` v2 com `nonEmpty` booleano + `tables` para o baseline do dia seguinte sem chave privada). Se o ciphertext subir e um companion falhar, o objeto órfão fica não-validado (preservado) e o job **não** reporta sucesso. Logs públicos (stdout/stderr do Actions) **não** imprimem `rowCounts` / `countGate.actual`.
5. Com `--sink=r2`, o upload usa a API S3-compatível do R2 com o token Object RW do bucket dedicado. Objetos usam o mesmo layout de chaves do sink local.
6. Listar o inventário **no mesmo sink**. Classificação em modo `hybrid` (padrão): SHA-256 completo só do objeto novo; demais objetos só manifesto + `contentLength` vs tamanho do manifesto (menos egress). **Companions** (`.meta.json.age` e `.counts.json`) têm presença + SHA-256 conferidos sempre; falha de parse do counts (`counts-parse-*`) conta como **corrupção**. Modo `full` baixa todos os ciphertexts.
7. `daily.mjs` falha (`ok: false`, exit ≠ 0) se o inventário estiver incompleto/corrupto ou o objeto novo não tiver hash completo (`manifest-hash-ok`). Sucesso só depois dessa prova. Workdirs temporários são limpos no `finally` mesmo em falha (não usar `process.exit` dentro do `try`).
8. Calcular retenção 14/8/12. Prune em dry-run por padrão. `--apply` / `--apply-prune` no R2 exige `R2_PRUNE_*`, revalida em modo `full` e **falha fechado se a reclassificação full achar corrupção** (não engole hash-mismatch nem `counts-parse-*`), se a validação estiver incompleta, se não houver âncora validada, se o inventário mudar entre plano e apply, ou se o plano apagaria o único/mais novo backup validado. No R2, o apply remove todas as versões do nome.
9. Periodicamente: `restore-rehearsal.mjs` em máquina isolada com a identity age do operador (obrigatório antes de ativar CI/schedule — ver `BACKUP_RESTORE_PROOF`).

O que **não** faz parte do fluxo:

- `aws s3 sync` / `rclone sync --delete` contra o bucket (risco de espelhar um diretório local vazio e apagar o acervo remoto, ou de achar que um `rm` local limpou o R2).
- Prune local como substituto de prune R2 (e o contrário). Cada `--sink` lista e apaga só nele.
- Agendamento automático ativo: o workflow `.github/workflows/backup-d1.yml` mantém o bloco `schedule:` comentado até medição do bloqueio do D1, secrets e prova de restore. O `if:` do job já aceita `schedule` **ou** `workflow_dispatch` com `ENABLE`; ver seção [Ativar o schedule](#ativar-o-schedule-caminho-documentado).
- Usar `recipients.example` como arquivo vivo (os scripts recusam).

## Criptografia age

- Criptografar só com **chaves públicas** (`age1...`) em `recipients.local` (gitignored) ou secret de CI (`BACKUP_AGE_RECIPIENT` / `AGE_RECIPIENT`). Vários recipients por arquivo (uma `age1` por linha) ou lista separada por vírgula.
- `recipients.example` é só template: sem chave funcional; scripts recusam usá-lo e recusam a chave órfã que já apareceu em versões antigas do exemplo.
- A **identity** (`AGE-SECRET-KEY-1...`) fica com o operador, fora do repositório (gerenciador de senhas + cópia de recuperação). Sem ela a restauração é impossível. CI e scripts de pack **não** recebem a identity.
- Manifesto JSON ao lado do `.age` guarda hashes (plaintext, gzip, ciphertext, sealed meta, counts), tamanhos e fingerprints dos recipients. **Não inclui `rowCounts` em claro.** O manifesto **não é assinado**. age dá confidencialidade aos recipients; **não autentica o remetente**. Quem puder reescrever o bucket pode reescrever manifesto, `.counts.json` e ciphertext juntos.
- `.counts.json` é baseline operacional público para o próximo pack (CI sem identity age). **v2** guarda `nonEmpty` (booleano por tabela essencial) + `tables` (schema presente); COUNTs exatos ficam só no `.meta.json.age`. Documentos v1 com `rowCounts` numéricos continuam legíveis (migração). Limites do snapshot ficam registrados nesse arquivo e no sidecar selado.

```bash
age-keygen -o ~/secure/palpitae-backup.identity
age-keygen -y ~/secure/palpitae-backup.identity > scripts/backup/recipients.local
chmod 600 ~/secure/palpitae-backup.identity
```

## Credenciais R2 (bucket dedicado, Object RW)

Variáveis (nunca commitadas). Tokens R2 da Cloudflare oferecem só Admin Read & Write, Admin Read only, Object Read & Write e Object Read only, com escopo por **bucket** (não por prefixo). **Object Read & Write inclui delete.**

| Variável | Uso |
|---|---|
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Pack/CI semanal: Object Read & Write no bucket dedicado `palpitae-backups` (write **e** delete) |
| `R2_PRUNE_ACCESS_KEY_ID` / `R2_PRUNE_SECRET_ACCESS_KEY` | Só no host do operador para `--apply` (também Object RW no mesmo bucket; o código lê exatamente estes nomes em `lib/r2-client.mjs`) |
| `R2_BUCKET` | Nome do bucket privado dedicado (`palpitae-backups`) |
| `R2_NAME_PREFIX` | Prefixo opcional de objetos dentro do bucket dedicado (também `--prefix`) |
| `BACKUP_RESTORE_PROOF` | Secret de CI **vinculado** aos fingerprints dos recipients do ensaio: `palpitae-restore-proof:v1:<fps-ordenados>:<token-operador>` (não string arbitrária, não `TODO`/`example`). Gate operacional de formato + fingerprints apenas: **não** prova posse da identity age, **não** prova que cada destinatário descriptografou, **não** substitui o ensaio real. |

O workflow de backup **não** recebe `R2_PRUNE_*`. `prune.mjs --apply` / `daily.mjs --apply-prune` no R2 exigem as variáveis de prune no host do operador.

**Limite real da key de CI:** com Object RW ela **pode apagar** e sobrescrever objetos no bucket. Separar “daily” e “prune” em dois tokens Object RW reduz blast radius operacional (só o host do operador aplica prune), mas **não** impede delete via a key de CI. A mitigação real de retenção imutável é configurar **[R2 bucket lock rules](https://developers.cloudflare.com/r2/buckets/bucket-locks/)** no bucket `palpitae-backups`, com janela maior que a do prune (ex.: retenção 14/8/12 ⇒ lock ≥ maior idade retida, tipicamente > 12 meses se mensais forem o piso). Bucket locks bloqueiam delete e overwrite enquanto a regra valer. Isso é passo do orquestrador; esta PR **não** aplica locks.

Sem tokens Admin nem keys de conta master nas variáveis de backup.

## Verificação de integridade e custo de egress

| Modo | O que baixa | Quando usar |
|---|---|---|
| `hybrid` (padrão daily) | Manifestos + SHA-256 completo só do objeto novo (e suspeitos com size mismatch) | Job diário |
| `full` | SHA-256 de **todos** os ciphertexts | `--apply` de prune; auditoria |
| `manifest-size` | Só manifesto + `contentLength` listado | Diagnóstico; não basta para apply |

**Limites explícitos**

- `contentSha1` / ETag do R2 **não** são autenticação ponta a ponta. Servem no máximo como check de transporte do provedor; quem reescreve o objeto pode reescrever esses metadados.
- Modo `hybrid` com tamanho igual ao do manifesto **não** detecta troca de conteúdo do mesmo tamanho nos objetos antigos. Por isso o objeto novo do dia é sempre hasheado por completo, e o apply de prune revalida em `full`.
- Manifesto unsigned + age sem autenticação de remetente: ver seção de criptografia.

**Estimativa de egress (ordem de grandeza)**

Suponha ~34 objetos retidos (14+8+12) e ciphertext médio `S` bytes:

- `hybrid` no daily: ~`S` bytes de ciphertext/dia (só o novo) + manifestos pequenos.
- `full` a cada run: ~`34 × S` bytes/run. Com `S = 20 MiB` → ~680 MiB/run; diário ≈ 20 GiB/mês só de verificação — pode comer a faixa free de egress (tipicamente 3× o volume médio armazenado/mês na página de preços Cloudflare R2; confirme no painel).
- O relatório JSON de `daily.mjs` / `prune.mjs` inclui `egressEstimate` com base nos `contentLength` listados.

Meça `S` real no primeiro export remoto antes de ligar o schedule.

## Workdirs e memória

- Diretórios de trabalho padrão: `~/.cache/scratch/palpitae-backup-tmp` (override `PALPITAE_BACKUP_TMP`). Evita dumps grandes em `/tmp` montado como tmpfs.
- `packAndStore` calcula hashes/tamanhos por streaming/`stat` e envia ao sink via `{ path }` em vez de reler o ciphertext inteiro para um segundo buffer desnecessário.
- Ensaios e testes simulados não chamam contas reais.

## Ensaio isolado (já automatizado)

Pré-requisitos locais: `node` ≥ 24, `sqlite3`, binário `age`/`age-keygen` no `PATH` ou via `PALPITAE_AGE_BIN` / `PALPITAE_AGE_KEYGEN_BIN`.

```bash
export PALPITAE_AGE_BIN=~/.cache/scratch/palpitae-backup-tools/age
export PALPITAE_AGE_KEYGEN_BIN=~/.cache/scratch/palpitae-backup-tools/age-keygen

npm run test:backup
npm run test:backup:rehearsal
```

O ensaio local:

- gera identity efêmera fora do repo;
- empacota `fixtures/synthetic.sql` no sink local;
- restaura em SQLite temporário;
- confere contagens e um spot-check;
- planeja prune em dry-run;
- apaga workdir e identity efêmera.

Os testes `r2-sink.test.mjs` exercitam upload/list/delete e os gates de retenção contra um **R2 simulado** (fetch injetado). Não chamam Cloudflare, não chamam R2 real, não lêem produção.

## Runbook de restauração (operador)

Ambiente isolado: máquina ou diretório sem apontar `wrangler` para o D1 de produção como destino do restore. Trabalhe num diretório privado (`0700`), nunca em `/tmp` compartilhado nem no cwd do repositório.

### Acesso ao R2 no desastre

O R2 vive na conta Cloudflare. Se a **plataforma Cloudflare** estiver indisponível ou a **conta** for perdida, o ciphertext desta fatia também fica inacessível. Esta fatia **não** entrega cópia fora da Cloudflare; isso fica como evolução futura (ex.: B2).

Para desastre operacional no D1 (com R2 ainda acessível) o restore precisa de:

1. Credenciais R2 de leitura (Object Read only ou a key Object RW do CI) guardadas no cofre do operador / gerenciador de senhas, não só nos secrets do GitHub Actions.
2. Nome do bucket dedicado, `R2_NAME_PREFIX` e o `ciphertextKey` / `stamp` do manifesto a restaurar (inventário recente impresso pelo `daily.mjs` ou listagem S3-compatível do R2).
3. Identity age offline (`~/secure/palpitae-backup.identity` + cópia de recuperação). Sem identity, o acervo R2 é inútil.
4. Não dependa do wrangler nem do checkout de produção para **baixar** o objeto; o download é API S3-compatível do R2 / CLI na máquina de restore.

### Passos de restore

1. Preferir o CLI isolado (baixa ciphertext + manifesto + `.meta.json.age`, descriptografa, importa, compara contagens seladas):

```bash
# sink local
node scripts/backup/restore.mjs \
  --sink=local --sink-dir="$SINK_DIR" \
  --ciphertext-key="$CIPHER_KEY" \
  --identity="$HOME/secure/palpitae-backup.identity" \
  --expect=sealed

# sink R2 (credenciais de leitura no ambiente; não restaura D1 remoto)
node scripts/backup/restore.mjs \
  --sink=r2 \
  --ciphertext-key="$CIPHER_KEY" \
  --identity="$HOME/secure/palpitae-backup.identity" \
  --expect=sealed
```

2. Alternativa manual: criar workdir privado e baixar `.sql.gz.age`, `.manifest.json` e `.meta.json.age`:

```bash
RESTORE_DIR="$HOME/.cache/scratch/palpitae-restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -p "$RESTORE_DIR"
# baixe/copie ciphertext + manifesto + meta cifrada para $RESTORE_DIR com modo 0600
```

3. Conferir `ciphertextSha256` do manifesto com o arquivo baixado (`sha256sum`). Não use ETag/SHA1 do R2 como prova de autenticidade.
4. Descriptografar dump e meta com a identity do operador **dentro do workdir**; conferir `plaintextSha256`; comparar `rowCounts` da meta selada com `COUNT(*)` após import.
5. Importar em SQLite local sob `$RESTORE_DIR` ou em um **D1 novo** de ensaio (`wrangler d1 create ... --config ./api/wrangler.toml` + `wrangler d1 execute --file ... --config ./api/wrangler.toml`), nunca no database_id de produção sem decisão explícita de desastre.
6. Validar **schema essencial** e as contagens seladas. **Não** assuma as contagens do fixture sintético (`SYNTHETIC_EXPECTATIONS`) para dumps reais — use `--expect=sealed` (padrão) ou `--expect=none` só para inspeção ad hoc.
7. Remover plaintext com overwrite + unlink (não use só `rm`):

```bash
node --input-type=module -e "
  import { scrubFile } from './scripts/backup/lib/pipeline.mjs';
  for (const f of ['dump.sql','dump.sql.gz','restored.sqlite']) {
    await scrubFile(process.env.RESTORE_DIR + '/' + f);
  }
" 
# com RESTORE_DIR exportado; em seguida: rm -rf "$RESTORE_DIR" só depois do scrub
```

Preferir `npm run test:backup:rehearsal` / `restore-rehearsal.mjs` quando o objetivo for só comprovar o fluxo — esses scripts já usam workdir `0700` e `scrubFile`.

### Sessões, revogações e usuários depois do snapshot

O dump é um ponto no tempo. Depois de um restore destrutivo em produção, o D1 volta ao estado do `stamp` do manifesto. Efeitos que o runbook precisa tratar **antes de reabrir**:

1. **Rotação global de `JWT_SECRET` invalida sessões e também os links de unsubscribe.** `api/src/notifications/unsubscribeToken.ts` assina o token one-click com o mesmo `JWT_SECRET` (HMAC domain-separated `unsub:`). O código exige que um link antigo continue válido para sempre. Rotacionar o secret faz **todo** link de unsubscribe já enviado falhar a verificação. **Não reabra o tráfego** só com a rotação: isso deixa usuários sem caminho de unsubscribe pelos e-mails antigos. Bloqueie a reabertura até existir uma **solução explícita validada** (por exemplo dual-secret só para verificar unsubscribe, ou reemissão controlada). Mudança de produto nesse token **não** faz parte desta fatia de backup — não implemente atalho sem decisão do operador.
2. **`POST /auth/logout-all` é individual**, não global. A rota exige sessão autenticada do próprio usuário e grava só `users.sessions_valid_after` daquele `userId` (migration `0017_sessions_valid_after`). Não use logout-all como substituto da rotação de `JWT_SECRET` após restore.
3. **`revoked_sessions` no dump.** Tokens revogados **depois** do stamp não estão na cópia restaurada — voltam a parecer válidos se o `JWT_SECRET` antigo for mantido. Tokens revogados **antes** do stamp reaparecem na tabela. Manter o secret antigo deixa esse buraco de sessão aberto; rotacionar sem plano de unsubscribe quebra os links (item 1).
4. **Usuários ausentes / reaparecidos.** Contas criadas depois do stamp somem no restore (e qualquer dado só delas). Contas apagadas depois do stamp **reaparecem**. Memberships, bans e palpites seguem o mesmo ponto no tempo. Planeje comunicação e reconciliação com Time Travel recente / logs / cold path AE→R2 quando existirem escritas posteriores.
5. Reconcile escritas **depois** do stamp antes de declarar o incidente fechado. Esse procedimento de desastre em produção **não foi ensaiado** aqui.

Escritas posteriores ao ponto de recuperação: palpites e resultados gravados depois do `stamp` do manifesto não estão na cópia.

### Corrupção: estado real e descarte manual seguro

**Sinal real no repositório:** inventário com hash/size/manifest/sidecar inválido (`corruptionCount > 0`, razões como `ciphertext-hash-mismatch`, `counts-parse-*`, companions ausentes) faz `daily.mjs` / `prune.mjs` sair com `ok: false` e código ≠ 0. Cobertura `hybrid` é **parcial** (objeto novo com SHA completo; antigos só manifesto+tamanho); `full` é **completa**. **Não há** alerta push/Slack/PagerDuty. **Frescor** (RPO) continua pendente. O único alarme automático é o exit code do job.

Quando `prune.mjs --apply` / `daily.mjs --apply-prune` encontra corrupção na reclassificação `full`, o apply **recusa apagar**. Cópias não validadas são preservadas de propósito (não há atalho de “limpar e seguir”).

**Baseline do objeto mais novo adulterado ou erro transitório (503):** a resolução de baseline **falha fechado**. Não cai em silêncio para um objeto mais antigo e **não** empacota/envia um objeto novo nesse estado. Órfãos incompletos de verdade (404/ENOENT de companion) ainda podem pular para o anterior; hash mismatch, parse quebrado e falha transitória de leitura do sink **não**. O preflight do workflow (`daily.mjs --preflight-only`) exerce essa checagem **antes** do `wrangler d1 export --remote --config ./api/wrangler.toml`.

Procedimento seguro de descarte manual (operador, sem apagar às cegas):

1. Rodar inventário em modo `full` no mesmo `--sink` / prefixo e anotar as chaves `unvalidated` + `reason` (companions públicos não precisam de identity age; sealed meta só confirma presença/hash).
2. **Não** passar `--apply` de novo até haver pelo menos um objeto **validado** mais novo que sirva de âncora, ou até o objeto corrompido ser tratado.
3. Se o objeto corrompido for o mais novo: investigar upload parcial / overwrite (key Object RW do CI). Preferir um novo pack bem-sucedido a partir de dump fresco **só depois** de o baseline do stamp ruim deixar de ser o candidato mais novo completo (ver passo 4). Enquanto o mais novo estiver adulterado, o job continua falhando de propósito.
4. Se um `.counts.json` foi alterado fora do manifesto (`baseline-counts-modified`): **não** edite o arquivo “na mão” para bater com um hash antigo. Opções seguras:
   - Restaurar o companion a partir de uma cópia íntegra (mesmo conteúdo que o `countsSha256` do manifesto), **ou**
   - Remover **manualmente no R2** (console ou API com chave de prune) o **conjunto** do stamp corrompido: `.sql.gz.age` + `.manifest.json` + `.meta.json.age` + `.counts.json` (todas as versões do nome, se versioning estiver ativo). Dry-run mental: confirme o prefixo e o stamp antes de apagar. O `prune --apply` do repo **não** faz esse descarte enquanto a corrupção existir — isso é intencional.
5. Depois do descarte ou da restauração do companion, rode `daily.mjs --preflight-only --sink=r2` (ou inventário `full`) e confirme baseline ok **sem** export remoto.
6. Só então rode um pack novo / o workflow. Só depois de `classify` full limpo (ou com corrupção isolada em stamps que você decide manter fora do prune set) rode `--apply` com `R2_PRUNE_*`. Dry-run primeiro.

## Metas propostas de perda e tempo (provisórias)

Derivadas só do ensaio sintético local. **Não são SLO de produção.**

| Meta | Proposta inicial | Base |
|---|---|---|
| RPO | 7 dias | Cadência pretendida do Actions é **semanal** (`daily.mjs` é nome histórico do orquestrador local); perda máxima nominal de uma semana de escritas |
| RTO (restore local sintético) | minutos baixos (ver `durationMs` do último `run-rehearsal.mjs`) | Medido no laptop; não inclui export remoto nem download R2 |
| RTO produção | pendente | Soma de: export/download, decrypt, provisionar D1 isolado ou swap, validação, DNS/app |

Lacunas que impedem fechar as metas:

- Duração e tamanho do `wrangler d1 export --remote --config ./api/wrangler.toml` em produção (e janela de bloqueio do D1).
- Tempo real de upload/download R2 na conta do operador.
- Restore em D1 isolado na Cloudflare (quota, migrations, binding).
- Confirmação do plano Cloudflare (janela Time Travel 7d vs 30d).
- Confirmação de que o volume retido permanece ≤ 10 GB free R2 após meses de operação.

## Configuração real pendente (operador / orquestrador)

1. Conta Cloudflare, bucket privado **dedicado** `palpitae-backups` (obrigatório; sem reutilizar `palpitae-events`).
2. Dois tokens R2 Object Read & Write no mesmo bucket (CI e prune). Ambos podem apagar; a mitigação de retenção imutável é configurar **bucket lock rules** com janela maior que a do prune ([docs](https://developers.cloudflare.com/r2/buckets/bucket-locks/)). Esta PR não aplica locks.
3. Criar o GitHub Environment `backup` com política de branch só `main` e mover os secrets `BACKUP_*` / `R2_*` / token de export D1 para esse environment.
4. Token Cloudflare **só de D1** (export) para o workflow, salvo como `BACKUP_D1_API_TOKEN` no environment `backup`. O workflow o entrega ao wrangler como `CLOUDFLARE_API_TOKEN`; o nome próprio faz a falta dele barrar o job em vez de cair no token de deploy do repositório.
5. Par de chaves age; identity só com o operador; `recipients.local` (nunca `recipients.example`).
6. Medir um export remoto controlado (horário de baixo uso) e registrar tamanho/duração/impacto de bloqueio e `S` (tamanho do ciphertext) para a estimativa de egress.
7. Primeiro upload real ao R2 (`--sink=r2`) e download com verificação SHA-256 do manifesto.
8. Ensaio de restore isolado bem-sucedido → gravar `BACKUP_RESTORE_PROOF` no environment `backup` no formato `palpitae-restore-proof:v1:<fingerprints-ordenados-dos-recipients-do-ensaio>:<token-operador>` (gere com o helper em `scripts/backup/lib/restore-proof.mjs` / saída do `run-rehearsal.mjs`). String arbitrária **não** basta. Isso **não** é prova criptográfica autenticada de posse da identity e **não** substitui o ensaio.
9. Só então considerar `schedule` no workflow (caminho abaixo) ou cron no host.
10. Ensaiar restore em D1 isolado (database novo), ainda sem tocar produção.
11. Documentar contato/procedimento se a identity age for perdida (sem identity, o acervo R2 é inútil).

## Ativar o schedule (caminho documentado)

O cron **permanece desligado** (`schedule:` comentado). Quando a medição, os secrets e a prova de restore existirem, o caminho correto é:

1. Confirmar que o Environment `backup` existe, restringe a branch `main`, e contém: `BACKUP_AGE_RECIPIENT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (Object RW no bucket dedicado; **pode apagar**), `R2_BUCKET=palpitae-backups`, token Cloudflare **só de D1**, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_RESTORE_PROOF` (e opcional `R2_NAME_PREFIX`). `R2_PRUNE_*` **fora** deste workflow.
2. Confirmar bucket lock rules ativas com retenção ≥ janela do prune (passo do orquestrador).
3. Escolher a expressão cron semanal a partir da janela de baixo uso medida.
4. Em `.github/workflows/backup-d1.yml`, **descomentar** o bloco `schedule:` sob `on:`.
5. **Manter** o `if:` do job exatamente como está:

   ```yaml
   if: ${{ github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.confirm == 'ENABLE')) }}
   ```

   Um `if` que exige só `workflow_dispatch && inputs.confirm == 'ENABLE'` impede o schedule mesmo depois de descomentar o cron (runs agendados não têm `inputs.confirm`). Sem `github.ref == 'refs/heads/main'`, o environment `backup` poderia ser acionado fora da política pretendida.
6. O workflow continua com `environment: backup`, `timeout-minutes: 30`, `npm ci` em `api/` (wrangler do lockfile), `age` com SHA-256 pinado, instalação de `sqlite3`, e step **Preflight tools + R2 baseline** (`--preflight-only`) antes do export. Ajuste o timeout depois de medir o export remoto.
7. Prune em CI permanece dry-run; apply fica com o operador + `R2_PRUNE_ACCESS_KEY_ID` / `R2_PRUNE_SECRET_ACCESS_KEY` após verificar o objeto novo.

## Segurança operacional

- Sink local e workdirs com modo `0700`; arquivos sensíveis `0600`. Workdirs padrão sob `~/.cache/scratch/...`, não em `/tmp` compartilhado.
- Dump validado (SQLite isolado + `integrity_check` + `foreign_key_check` + schema essencial + gate de contagens com evidência) **antes** de cifrar; vazio/lixo/schema-only sem evidência/truncado em fronteira SQL/FK quebrada falha fechado. Contagens essenciais vão no sidecar `.meta.json.age` (mesmos recipients) e no `.counts.json` público (baseline do próximo pack). Limites honestos do snapshot: COUNTs pós-import não provam truncamento parcial com COUNTs > 0, consistência transacional entre tabelas, autenticidade do publisher nem igualdade com um live DB num instante diferente.
- `prune.mjs` / `daily.mjs` só removem chaves que passam no parser de nome **e** na validação; dry-run é o padrão. Cópias não validadas são preservadas.
- Gates recusam `--apply` se a validação estiver incompleta, não houver backup validado, o keep set estiver vazio, o mais novo validado estiver no prune set, existir um único validado, o inventário mudar entre plano e apply, ou um não-validado entrar no prune set.
- No R2, delete remove o objeto (e versões, se versioning estiver ativo); o cliente limita retry de reautenticação a **uma** tentativa (sem recursão ilimitada). Upload parcial (ciphertext sem manifesto) não marca o job como sucesso. Bucket lock rules, quando configuradas pelo orquestrador, bloqueiam delete/overwrite na janela de retenção.
- Falha no pack **ou** na verificação pós-pack do objeto novo (`daily.mjs`) **não** executa prune e sai com código ≠ 0 (`ok: false`).
- `--source=d1-remote` exige `--i-understand-remote-export`.
- Identity dentro do checkout é recusada pelo restore. `recipients.example` é recusado como arquivo vivo.
- Logs públicos usam códigos fixos em falhas de sqlite (`sqlite-import-failed`, `sqlite-foreign-key-violations:N`, …) e sanitizam COUNTs, fragmentos SQL, rowids, números de linha e tamanhos exatos (`plaintextBytes` / `gzipBytes` / `ciphertextBytes` / `dumpValidation.bytes`). Detalhe privado só com `PALPITAE_BACKUP_PRIVATE_ERRORS=1` em host do operador.
- Import do dump usa `sqlite3 -safe` com ambiente mínimo (sem herdar secrets R2/Cloudflare).
- O workflow instala `sqlite3`, valida age+sqlite, e roda `--preflight-only` (baseline+R2) **antes** do export remoto.
- Credenciais R2 de CI e de prune ficam em tokens separados; secrets no Environment `backup` (branch `main`); token de export D1 separado do token de deploy.
- O workflow faz overwrite+unlink do `dump.sql` (`scrubFile`); não confie em `rm` sozinho para plaintext.
- Ameaça residual: manifesto não assinado + age sem autenticação de remetente + key Object RW comprometida pode **escrever e apagar** backups. Bucket lock rules mitiga delete/overwrite prematuro; detectar ciphertext forjado exige processo operacional (restore rehearsal + inspeção do exit code do `daily.mjs`), não só o hash do manifesto no próprio bucket.
- **Monitoramento (estado real):** corrupção de inventário (hash/size/manifest inválido) faz o job falhar (`ok: false`, exit ≠ 0). Cobertura `hybrid` = **parcial**; `full` = **completa**. **Não há** alerta push/Slack/PagerDuty no repositório. **Frescor** (aviso quando o backup validado mais novo passa do RPO de 7 dias) ainda está **pendente**.

## Tradeoffs

- Export D1 bloqueia o banco durante a operação: o schedule semanal precisa de janela consciente (por isso permanece desligado).
- Cópia completa (não incremental) simplifica restore e retenção; cresce com o banco.
- age com recipient pública no CI permite encrypt sem private key no CI; restore exige o operador.
- R2 free de 10 GB pode deixar de bastar; aí há custo ou outra decisão de retenção/compressão.
- R2 na mesma conta CF não cobre perda da conta/plataforma Cloudflare, perda da identity age, nem erro de prune com `--apply` mal usado (gates e bucket locks mitiga, não eliminam).

## Comandos úteis

```bash
# Testes unitários (sem rede; R2 simulado). No CI: age + sqlite3 instalados,
# PALPITAE_BACKUP_REQUIRE_AGE=1 (não pula testes de encrypt/decrypt).
npm run test:backup

# Ensaio completo sintético local (precisa age)
PALPITAE_AGE_BIN=... PALPITAE_AGE_KEYGEN_BIN=... npm run test:backup:rehearsal

# Restore isolado (local ou R2 de leitura; não aponta para D1 de produção)
node scripts/backup/restore.mjs --sink=local --sink-dir=... --ciphertext-key=... --identity=...

# Empacotar fixture contra sink local (nunca contra o prefixo R2 de produção)
node scripts/backup/backup.mjs \
  --source=fixture \
  --recipient="$(age-keygen -y "$HOME/secure/palpitae-backup.identity")" \
  --sink=local \
  --sink-dir="$HOME/.cache/scratch/palpitae-backup-sink"

# Empacotar e enviar ao R2 (credenciais no ambiente; conta real do operador)
# Primeiro pack real: --bootstrap-with-evidence=@arquivo (caminho absoluto; ~ não expande em --flag=)
# Packs seguintes: daily.mjs resolve sozinho o .counts.json anterior validado (sem identity).
# Rode a partir da raiz do repo, ou passe caminhos absolutos em todo --*-file / @path.
node scripts/backup/backup.mjs \
  --source=sql-file \
  --sql-file="$HOME/.cache/scratch/palpitae-backup-tmp/dump.sql" \
  --recipients-file="$PWD/scripts/backup/recipients.local" \
  --sink=r2 \
  --bootstrap-with-evidence=@"$HOME/.cache/scratch/palpitae-backup-bootstrap.json"

# Orquestração diária com dump real (prune dry-run). NÃO use --source=fixture no R2 real.
node scripts/backup/daily.mjs \
  --sink=r2 \
  --source=sql-file \
  --sql-file="$HOME/.cache/scratch/palpitae-backup-tmp/dump.sql" \
  --recipients-file="$PWD/scripts/backup/recipients.local"

# Planejar retenção no R2
node scripts/backup/prune.mjs --sink=r2

# Aplicar retenção no R2 (só depois de confirmar o objeto novo)
node scripts/backup/prune.mjs --sink=r2 --apply

# Restaurar um objeto local (identity fora do repo; use $HOME — ~ não expande em --identity=...)
node scripts/backup/restore-rehearsal.mjs \
  --sink-dir="$HOME/.cache/scratch/palpitae-backup-sink" \
  --ciphertext-key='d1/palpitae/2026/11/03/palpitae-d1-....sql.gz.age' \
  --identity="$HOME/secure/palpitae-backup.identity"
```

**Proibido:** `daily.mjs --sink=r2 --source=fixture` contra o prefixo real — o fixture viraria o “mais novo validado” e distorceria a retenção. `backup.mjs` recusa fixture→R2 sem `--allow-fixture-to-r2` (só para testes / prefixo descartável).
