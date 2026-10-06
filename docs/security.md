# Controle de acesso e limites da API

## Grupos e palpites

O servidor exige participação em grupo ativo para consultar ou salvar palpites.
Excluir um grupo revoga o acesso aos seus dados, preservando os registros no banco.
Somente o dono recebe o código de convite na resposta do detalhe do grupo.

Quando o dono remove um membro, o servidor registra o bloqueio em `group_bans` e
remove a participação na mesma transação. O convite antigo deixa de permitir a
reentrada dessa pessoa. O bloqueio vale somente para esse grupo; a conta e os
outros grupos continuam disponíveis. Sair voluntariamente permite entrar de novo
com um convite válido. A interface atual não oferece remoção de bloqueios.

Em grupos `hidden`, o usuário vê o próprio palpite enquanto ainda pode editá-lo.
Os palpites dos outros membros aparecem após o bloqueio da partida por horário ou
status `live`/`finished`. Registrar o próprio palpite não antecipa essa revelação.
Grupos `public` continuam mostrando os palpites a todos os membros em tempo real.

## Sessões

O logout registra o hash SHA-256 da sessão em `revoked_sessions` até seu vencimento.
Uma cópia desse token passa a falhar tanto nas rotas autenticadas quanto em
`/auth/me`. Cada login novo recebe um identificador aleatório; sair de uma sessão
preserva as demais. A validade da sessão continua em 30 dias. A revogação também
vale para tokens emitidos antes do identificador de sessão. Dois desses tokens
antigos, emitidos no mesmo segundo para o mesmo usuário, são idênticos, então o
logout de um derruba o outro.

Cada requisição consulta `revoked_sessions` uma vez: o limitador verifica o cookie
e guarda o resultado no contexto, e o `requireAuth` e o `/auth/me` o reaproveitam.
Se o D1 não responder nessa consulta, rotas autenticadas e `/auth/me` respondem 503.
No logout, o cookie é apagado na resposta mesmo quando a revogação falha; nesse
caso a resposta é 503 e a falha vai para o evento `security_storage_error`.

## Consumo de recursos

O limite do body é 64 KiB, aplicado antes da leitura do JSON. O endpoint bulk aceita
até 100 palpites por requisição. As quotas usam uma janela fixa de 60 segundos:

| Categoria | Por usuário ou IP | Balde anônimo compartilhado |
|---|---|---|
| Início e callback de OAuth | 30 | 300 |
| Leituras | 300 | 3000 |
| Escritas | 60 | 600 |

A identidade de cada requisição é uma só:

- Sessão válida: o contador do usuário (`user:<id>`). O IP não entra.
- Sem sessão, vinda do proxy do Pages com o segredo correto: o IP do visitante
  que o proxy repassa em `X-Palpitae-Client-IP`.
- Sem sessão, vinda de um Worker sem o segredo correto (header `CF-Worker` ou
  `CF-Connecting-IP` igual ao endereço de saída dos Workers): o balde anônimo
  compartilhado, com o teto da última coluna.
- Sem sessão, acesso direto à API: `CF-Connecting-IP`. Requisições locais sem esse
  header compartilham um contador de desenvolvimento.

O IP não serve para usuários logados porque o front em produção chama a API pelo
proxy `/api` (Pages Function em `web/functions/api/[[path]].ts`). Esse `fetch` é um
subrequest de Worker para outra zona, e nesse caso a Cloudflare preenche
`CF-Connecting-IP` com o endereço de saída dos Workers (`2a06:98c0:3600::103`),
igual para todos os visitantes
([documentação](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip-in-worker-subrequests)).

O contador usa um upsert atômico no D1, compartilhado entre instâncias do Worker,
com uma escrita por requisição. As chaves dos contadores são HMAC-SHA256 da
identidade com `JWT_SECRET`. `/health` e preflight OPTIONS ficam fora das quotas.
Uma janela fixa permite rajadas em lados opostos da sua virada.

Ao exceder a quota, a API responde 429 com `Retry-After`. Se o contador falhar
(D1 indisponível), leituras GET/HEAD seguem sem contagem e escritas e OAuth
respondem 503. As duas situações registram `security_storage_error`.

Mutações com cabeçalho Origin aceitam somente o frontend (`FRONTEND_URL`) e a
origem da API. Previews do Pages (`*.pages.dev`) recebem 403 em mutações. Clientes
de servidor sem Origin continuam permitidos conforme autenticação da rota. O link
de unsubscribe exige seu token HMAC próprio.

`GET /matches` consulta somente dados locais e usa chave de cache composta por
competição, rodada e status. Parâmetros desconhecidos não criam novas entradas.
Atualizações externas dependem dos crons e do sync manual autenticado como admin.
O poller busca resultados na janela ativa (115 a 200 minutos após o início) e, como
resgate, de jogos iniciados há até 24 horas que ainda não estão finalizados ou que
terminaram sem pontuação. Jogos adiados ficam fora do resgate. Depois de 24 horas,
um jogo sem resultado só volta a ser atualizado pela descoberta diária ou pelo
sync manual. Competição nova sem jogos recebe os jogos no próximo cron de
descoberta (06:00 UTC).

## Segredo do proxy

`PROXY_SHARED_SECRET` precisa ter o mesmo valor no Worker da API e no projeto do
Pages. O proxy remove `X-Palpitae-Client-IP` e `X-Palpitae-Proxy-Secret` vindos do
visitante e, com o segredo configurado, envia os dois com o `CF-Connecting-IP` que
recebeu. A API compara o segredo em tempo constante e ignora o IP repassado quando
ele não confere.

Para configurar, gere um valor aleatório (por exemplo `openssl rand -hex 32`) e:

```bash
# Worker da API
cd api && npx wrangler secret put PROXY_SHARED_SECRET
# Pages (ou Settings > Variables and Secrets no painel, como secret de produção)
npx wrangler pages secret put PROXY_SHARED_SECRET --project-name palpitae-web
```

O Pages só passa a enviar o segredo após um novo deploy. Sem o segredo, ou com
valores diferentes, usuários logados continuam com o limite por usuário e o
tráfego anônimo que passa pelo proxy divide o balde compartilhado. Para trocar o
valor sem 429 em massa, atualize os dois lados em sequência; durante a troca o
tráfego anônimo cai no balde compartilhado.

## Migração

A migração `0015_access_controls.sql` cria as tabelas de bloqueio de membros,
revogação de sessões e contadores. O workflow de deploy da API aplica as migrações
antes de publicar o Worker. Sem a migração, a verificação de sessão responde 503
nas rotas autenticadas, escritas e OAuth respondem 503 e leituras anônimas passam
sem contador. Os crons removem contadores e revogações expirados, mas não removem
bloqueios de membros.
