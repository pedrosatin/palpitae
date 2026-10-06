# Controle de acesso e limites da API

## Grupos e palpites

O servidor exige participação em grupo ativo para consultar ou salvar palpites.
Excluir um grupo revoga o acesso aos seus dados, preservando os registros no banco.
Somente o dono recebe o código de convite na resposta do detalhe do grupo.

O dono pode trocar o código de convite em `POST /groups/:id/invite/rotate` (botão
"Trocar código" na seção de convite do grupo). O código anterior deixa de funcionar
na hora; quem já é membro continua no grupo. Use quando o código ou o link vazar.

O limite de membros é verificado no próprio `INSERT` da entrada, então duas
entradas simultâneas não passam do limite.

Quando o dono remove um membro, o servidor registra o bloqueio em `group_bans` e
remove a participação na mesma transação. O convite antigo deixa de permitir a
reentrada dessa pessoa. O bloqueio vale somente para esse grupo; a conta e os
outros grupos continuam disponíveis. Sair voluntariamente permite entrar de novo
com um convite válido. A interface atual não oferece remoção de bloqueios.

Em grupos `hidden`, o usuário vê o próprio palpite enquanto ainda pode editá-lo.
Os palpites dos outros membros aparecem após o bloqueio da partida por horário ou
status `live`/`finished`. Registrar o próprio palpite não antecipa essa revelação.
Grupos `public` continuam mostrando os palpites a todos os membros em tempo real.
Nos dois modos, o feed do grupo mostra só palpites de quem ainda é membro; os de quem
saiu ou foi removido ficam no banco, mas saem do feed.

O palpite trava no horário do jogo. A coluna `matches.locked_at` (migração
`0016_match_locked_at.sql`) guarda o instante em que o sync viu o jogo iniciado pela
primeira vez: status de início do provider (`IN_PLAY`, `PAUSED`, `LIVE`,
`SUSPENDED`, `FINISHED`, `AWARDED`) ou status local `live`/`finished`. Não é o
horário em que a bola rolou, e a coluna nunca volta a ficar vazia. Com `locked_at`
preenchido, o palpite fica travado mesmo que o provider depois marque o jogo como
suspenso, adiado ou cancelado, ou mude o horário para mais tarde.

Horário vencido sozinho não grava `locked_at`. Se o sync vê um adiamento de um jogo
que não começou, mesmo depois do horário original, o palpite reabre até o novo
horário. Os palpites revelados entre o horário original e esse sync voltam a ficar
ocultos para os outros membros. O placar de um palpite vai de 0 a 99.

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
- Sem sessão, vinda do proxy do Pages (ou da Function de preview de convite) com o
  segredo correto: o IP do visitante repassado em `X-Palpitae-Client-IP`.
- Sem sessão, vinda de um Worker sem o segredo correto (header `CF-Worker` ou
  `CF-Connecting-IP` igual ao endereço de saída dos Workers): um balde anônimo
  compartilhado, com o teto da última coluna. São dois baldes separados: um para o
  próprio front (`CF-Worker` igual à zona do `FRONTEND_URL`) e outro para qualquer
  outro Worker. Um Worker de terceiros esgota só o segundo.
- Sem sessão, acesso direto à API: `CF-Connecting-IP`. Requisições locais sem esse
  header compartilham um contador de desenvolvimento.

Endereços IPv6 contam pelo prefixo /64 (`2001:db8:1:2::/64`), porque um cliente
costuma controlar o /64 inteiro. IPv4-mapped (`::ffff:a.b.c.d`) conta como o IPv4.

O IP não serve para usuários logados porque o front em produção chama a API pelo
proxy `/api` (Pages Function em `web/functions/api/[[path]].ts`). Esse `fetch` é um
subrequest de Worker para outra zona, e nesse caso a Cloudflare preenche
`CF-Connecting-IP` com o endereço de saída dos Workers (`2a06:98c0:3600::103`),
igual para todos os visitantes
([documentação](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip-in-worker-subrequests)).

O contador usa um upsert atômico no D1, compartilhado entre instâncias do Worker.
Requisições aceitas gravam uma linha; quando o balde da janela já está cheio, o
`WHERE` do upsert impede a escrita e a requisição recusada só lê a linha. Assim um
cliente insistente recebendo 429 não gera escrita no D1. As chaves dos contadores são HMAC-SHA256 da
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

## Proteção de borda (Cloudflare Rate Limiting)

O limitador da API roda depois que a requisição chega ao Worker e ainda faz uma
leitura no D1 por requisição recusada. Para cortar rajadas antes disso, configure
uma regra de Rate Limiting na zona da API:

1. No painel da Cloudflare, abra a zona `palpitae.com.br` e vá em
   **Security > WAF > Rate limiting rules > Create rule**.
2. Nome: `api-por-ip`. Em **If incoming requests match**, use a expressão
   `(http.host eq "api.palpitae.com.br" and not http.request.uri.path eq "/health")`.
   O plano Free aceita menos campos na expressão; se o painel recusar, restrinja
   pelo caminho e pelo host disponíveis no plano.
3. Em **With the same characteristics**, escolha **IP** (no plano gratuito é a
   única opção).
4. Em **When rate exceeds**, use um teto acima da quota da API, para a borda só
   pegar abuso claro: por exemplo 600 requisições a cada 1 minuto (no plano
   gratuito o período é 10 segundos; use 100 a cada 10 segundos).
5. **Then take action**: **Block**, com duração de 1 minuto (no plano gratuito a
   duração é fixa em 10 segundos).
6. Salve com **Deploy** e acompanhe em **Security > Events** por alguns dias. Se
   aparecer bloqueio de tráfego legítimo, aumente o teto antes de reduzir a duração.

O tráfego do proxy do Pages chega à API pelo endereço de saída dos Workers, igual
para todos os visitantes, então uma regra por IP na zona da API também contaria
esse tráfego junto. Para não bloquear o próprio front, acrescente à expressão
`and not cf.worker.upstream_zone eq "palpitae.com.br"`, ou crie uma regra
equivalente na zona do front para `/api/*`, onde o IP é o do visitante. Para barrar
subrequests de Workers de outras contas, uma regra de WAF Custom com
`(http.host eq "api.palpitae.com.br" and cf.worker.upstream_zone ne "" and cf.worker.upstream_zone ne "palpitae.com.br")`
e ação **Block** resolve na borda. Confira no painel se os campos estão disponíveis
no plano da zona antes de salvar.

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

Com o segredo configurado, o proxy de `/api/*` e a Function de preview de convite
(`/convite/:code`) repassam o IP do visitante, e esse tráfego sai do balde anônimo
compartilhado: cada visitante conta no próprio IP. Configurar o
`PROXY_SHARED_SECRET` encerra o compartilhamento do balde pelo front; o balde
compartilhado fica só para Workers sem o segredo.

O Pages só passa a enviar o segredo após um novo deploy. Sem o segredo, ou com
valores diferentes, usuários logados continuam com o limite por usuário e o
tráfego anônimo que passa pelo proxy divide o balde compartilhado. Para trocar o
valor sem 429 em massa, atualize os dois lados em sequência; durante a troca o
tráfego anônimo cai no balde compartilhado.

## Migrações

A migração `0016_match_locked_at.sql` cria `matches.locked_at` e a preenche só nos
jogos com status `live` ou `finished`, pela mesma regra do sync. O workflow de
deploy da API aplica a migração antes de publicar o Worker.

A migração `0015_access_controls.sql` cria as tabelas de bloqueio de membros,
revogação de sessões e contadores. O workflow de deploy da API aplica as migrações
antes de publicar o Worker. Sem a migração, a verificação de sessão responde 503
nas rotas autenticadas, escritas e OAuth respondem 503 e leituras anônimas passam
sem contador. Os crons removem contadores e revogações expirados, mas não removem
bloqueios de membros.
