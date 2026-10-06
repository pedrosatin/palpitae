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
aceita os tokens anteriores sem identificador de sessão.

## Consumo de recursos

O limite do body é 64 KiB, aplicado antes da leitura do JSON. O endpoint bulk aceita
até 100 palpites por requisição. As quotas usam uma janela fixa de 60 segundos:

| Categoria | Requisições por janela |
|---|---|
| Início e callback de OAuth | 30 |
| Leituras | 300 |
| Escritas | 60 |

As quotas valem por IP e também por usuário com sessão válida. O contador usa um
upsert atômico no D1, compartilhado entre instâncias do Worker. Os identificadores
dos contadores são hashes. Requisições locais sem `CF-Connecting-IP` compartilham
um contador de desenvolvimento. `/health` e preflight OPTIONS ficam fora das
quotas. Uma janela fixa permite rajadas em lados opostos da sua virada.

Ao exceder a quota, a API responde 429 com `Retry-After`. Falha no armazenamento do
contador responde 503. A persistência adiciona operações de leitura/escrita ao D1
por requisição; esses limites protegem o serviço e também precisam entrar no
planejamento da quota do banco. Tráfego volumoso deve receber proteção adicional
no edge para evitar que as tentativas atinjam o contador.

Mutações com cabeçalho Origin aceitam somente o frontend e a origem da API.
Clientes de servidor sem Origin continuam permitidos conforme autenticação da
rota. O link de unsubscribe exige seu token HMAC próprio.

`GET /matches` consulta somente dados locais e usa chave de cache composta por
competição, rodada e status. Parâmetros desconhecidos não criam novas entradas.
Atualizações externas dependem dos crons e do sync manual autenticado como admin.
A descoberta diária cobre também competições ativas ainda sem jogos; elas podem
aguardar o próximo cron após serem cadastradas.

## Migração

A migração `0015_access_controls.sql` cria as tabelas de bloqueio de membros,
revogação de sessões e contadores. Ela precisa ser aplicada antes de publicar o
Worker que usa esses controles. Os crons removem contadores e revogações expirados.
Aplicar somente o Worker sem a migração deixa rotas limitadas indisponíveis.

Os crons não removem bloqueios de membros. As tabelas continuam funcionando com os
bindings D1 existentes; nenhum serviço adicional é necessário.
