# Configuração de pontuação e visibilidade por grupo

Cada grupo define na criação como os palpites são pontuados e quem enxerga os
palpites alheios. O dono pode editar o nome e os pontos de classificado em
`PATCH /groups/:id`. Placar exato, vencedor, pênaltis e visibilidade continuam
definidos na criação. Grupos antigos herdam os defaults das migrations.

## Campos (tabela `groups`)

| Campo | Tipo | Default | Restrição |
|---|---|---|---|
| `points_exact` | INTEGER 0–10 | 3 | Pontos por acertar o placar exato |
| `points_winner` | INTEGER 0–10 | 1 | Pontos por acertar só o vencedor/empate |
| `points_penalty` | INTEGER 0–10 | 1 | Bônus por acertar o vencedor dos pênaltis (`migration 0010`) |
| `points_classified` | INTEGER 0 a 10 | 0 | Bônus por acertar quem avança no jogo decisivo (`migration 0023`); editável pelo dono |
| `predictions_visibility` | `'hidden'` \| `'public'` | `'hidden'` | Visibilidade dos palpites alheios |

## Invariantes (validadas na API **e** no front)

1. Os quatro valores de pontuação são inteiros em `0..10`.
2. `points_exact + points_winner > 0` — não pode zerar os dois.
3. `points_exact === 0` **ou** `points_exact >= points_winner`.

A regra 3 é a chave da customização: `points_exact = 0` é sempre permitido (ativa o modo
"só vencedor" / 1X2, abaixo). Quando `points_exact > 0`, um acerto de placar exato precisa
valer **pelo menos** o que vale um acerto só de vencedor — caso contrário a precisão seria
penalizada. Logo `(1, 3)` é rejeitado, mas `(0, 1)` é aceito.

## Modo 1X2 (`points_exact = 0`)

Quando `points_exact = 0` não existe bônus por placar exato — só importa acertar o
resultado (Casa / Empate / Fora). O `MatchCard` troca os dois inputs de placar por 3 botões
e grava o palpite como placar:

| Botão | placar gravado |
|---|---|
| Casa | `(1, 0)` |
| Empate | `(0, 0)` |
| Fora | `(0, 1)` |

Mesmos endpoints (`PUT /predictions`) e schema — muda só a UI.

**Importante** (`calculatePoints`): no modo 1X2 o ramo de "acerto exato" é **desativado**
(`if (pointsExact > 0 && ...)`). Sem isso, um palpite "Casa" gravado como `(1,0)`
pontuaria `points_exact` (= 0) por engano quando o jogo terminasse exatamente 1-0, dando 0
em vez de acertar o vencedor. Com o ramo desativado, qualquer resultado correto pontua
`points_winner`.

## Presets de UI (CreateGroupModal)

| Label | points_exact | points_winner | UI de palpite |
|---|---|---|---|
| Clássico | 3 | 1 | placar |
| Só placar exato | 3 | 0 | placar |
| Só vencedor | 0 | 1 | 1X2 (3 botões) |
| Personalizado | livre | livre | placar (1X2 se exact = 0) |

## `exact_hits` no leaderboard

`recalculateLeaderboard` infere "acerto exato" a partir dos pontos: conta como exato quando
`points_awarded = points_exact` **e** `points_exact > points_winner` (bônus distinguível de
um acerto só de vencedor). Configs onde `points_exact <= points_winner` (inclui o modo 1X2 e
`(1,1)`) reportam `exact_hits = 0` — não há bônus de placar a detectar.

## Ordem do ranking, posição e empate total

O ranking do grupo tem uma ordem só, definida em `api/src/groups/ranking.ts`:

1. mais pontos (`total_points`);
2. mais placares exatos (`exact_hits`);
3. quem tem linha no `leaderboard` antes de quem não tem;
4. quem entrou primeiro no grupo (`group_members.joined_at`);
5. `user_id`, só para a ordem ser determinística quando duas entradas têm o mesmo horário.

No empate total, dois participantes com os mesmos pontos e os mesmos exatos não
dividem posição: fica à frente quem entrou antes no grupo. Não existe posição
compartilhada nem título dividido.

A lista de `GET /groups/:id/members`, o `user_position` de `GET /groups` e de
`GET /groups/:id`, o pódio do card do grupo encerrado e a variação de posição de
`GET /groups/:id/round-standings` usam essa ordem. O cartão de compartilhamento monta a
imagem com o `user_position` e o pódio, então segue a mesma ordem.

A linha do `leaderboard` nasce na primeira apuração do grupo depois que
o participante palpitou. Antes disso ele aparece no fim da lista de membros com 0
ponto, `user_position` vem `null` e ele não entra no pódio. A web mostra "—" no lugar
da posição e não o trata como campeão.

Participante elegível é quem tem linha em `group_members` e não está em
`group_bans`, e só ele conta. A saída e a remoção apagam a linha do `leaderboard` na mesma transação.
Os palpites ficam no banco, e o recálculo não recria a linha de quem saiu ou foi
banido. Quem saiu por conta própria e volta recupera a linha na entrada, a partir
dos palpites, com a data de entrada nova.

## Bônus de pênalti (`points_penalty`)

Em **jogo único de mata-mata** decidido nos pênaltis, um palpite de **empate** que também
acerta o **vencedor da disputa de pênaltis** ganha `+points_penalty` além do base. É um
bônus **aditivo e independente**:

- **Não** entra na invariante `points_exact >= points_winner` — valida só `0..10`.
- **Não** exige placar exato: basta acertar o resultado empate + o vencedor do pênalti
  (`calculatePenaltyBonus`). Funciona inclusive no modo 1X2 (`points_exact = 0`).
- `points_penalty = 0` desliga o bônus.
- Errar o vencedor não penaliza — só não dá o bônus.

### Gate por `(competição, fase)` — fonte de verdade `competitions.penalty_phases`

Cada competição lista em `competitions.penalty_phases` as fases que admitem pênaltis
em jogo único. Fora dessa lista, jogo único não pede nem pontua pênaltis.

Nos confrontos de ida e volta, a ida não tem pênaltis. A volta usa o agregado dos
dois palpites, com os mandos invertidos. Se ele empata, a interface pede o vencedor
dos pênaltis mesmo quando o palpite da volta tem um vencedor. Se o agregado não
empata, um empate no placar da volta não pede pênaltis. Sem palpite na ida, não
há bônus de pênaltis na volta. Essa regra vale nas fases de mata-mata mesmo
quando a fase não consta em `penalty_phases`, como as oitavas da Champions.

A API de jogos retorna `decides_on_penalties`, `tie_role` e `leg1_match_id`. O vínculo
entre jogos não contém palpites de usuários. A interface combina esse vínculo
com os palpites do próprio usuário para decidir se mostra o seletor.

O card da volta mostra o placar real da ida e, com a volta encerrada, o agregado
e quem avançou. Com a volta aberta e a ida palpitada, mostra o agregado previsto.
É só informação e não muda a pontuação.

### Placar canônico (regressão do bug do `fullTime`)

O palpite compara contra `regularTime + extraTime` (sem os gols de pênalti). Em
`PENALTY_SHOOTOUT` o `fullTime` da football-data **inclui** os pênaltis, então `sync.ts`
grava o canônico (`home_score`/`away_score`) e guarda os gols de pênalti à parte
(`home_penalty_goals`/`away_penalty_goals`) + `penalty_winner` para display "1-1 (5-4
pênaltis)".

### Por que `penalty_points` é coluna separada

`recalculateLeaderboard` infere `exact_hits` por `points_awarded == points_exact`. Somar o
bônus em `points_awarded` quebraria essa detecção. `points_awarded` guarda o placar,
`penalty_points` guarda os pênaltis e `classified_points` guarda o classificado.
O ranking soma os três valores em `total_points`. Repontuar reescreve os bônus,
com zero quando não se aplicam.

## Visibilidade

- `hidden` (default): o palpite alheio aparece somente quando o jogo está bloqueado
  por horário ou status. O usuário continua vendo e editando o próprio palpite antes
  do bloqueio. O servidor aplica a regra em `GET /predictions/group`.
- `public`: todos veem todos em tempo real, sem filtro (opt-in explícito do criador).

`GET /predictions/group` também devolve `open_pickers`, com os ids dos membros que já
palpitaram cada jogo aberto. O campo traz só presença, sem placar, e por isso existe nos dois
modos. O grupo `hidden` recebe a lista antes do início e continua sem o placar dos outros em
`predictions`.

A visibilidade é sempre resolvida no servidor a partir do banco — o front nunca decide o que
revelar. O `points_exact` enviado ao front é só para a UI; a pontuação real usa os valores do
banco em `scoreMatch`.

### Palpites e pontos na interface

- A aba Palpitar mostra o seletor quando o placar previsto de um jogo único elegível
  empata, ou quando o agregado previsto da volta empata. É preciso escolher o vencedor
  antes de salvar pela interface. A API aceita uma volta sem escolha, com zero de bônus.
- "Salvar todos" inclui rascunhos de placar e de pênaltis. Quando a ida e a volta estão
  em edição na mesma rodada, usa os rascunhos dos dois jogos. O salvamento individual
  da volta aguarda a ida ser salva, para a API usar o mesmo agregado mostrado na tela.
- As abas Palpitar e Grupo mostram o classificado previsto e somam os três tipos de
  ponto. O detalhe de palpites aberto pelo ranking também inclui os bônus no total.

Os rascunhos de placar e de pênalti ainda não salvos ficam no `localStorage`, na chave
`palpitae:rascunho-palpite:<userId>:<groupId>`, e voltam ao reabrir a aba Palpitar. Cada
entrada guarda o palpite salvo no momento da digitação e a hora da edição. A entrada some
depois de 7 dias, quando o jogo trava ou quando o palpite salvo muda, seja pelo card, pelo
"Salvar todos", por importação ou em outro aparelho. O logout explícito e o "Sair de todos
os dispositivos" apagam todas as chaves desse prefixo, e a sessão expirada as mantém. Com
rascunho pendente, o seletor marca a rodada com "· não salvo", e fechar ou recarregar a
página pede confirmação do navegador.

## Bônus de classificado (`points_classified`)

O classificado é derivado dos placares previstos, sem palpite adicional. Na volta,
a soma considera os mandos invertidos. No empate do agregado, vale o vencedor de
pênaltis previsto na volta. Em final ou jogo único, vale o vencedor do placar ou,
no empate, dos pênaltis. Sem palpite em um dos jogos, não há ponto de classificado.

O bônus é creditado somente depois do jogo decisivo encerrado, e zero desliga a
regra. A API retorna `predicted_classified` como `home`, `away` ou `null`, sempre
na orientação do jogo decisivo, além de `classified_points`. Os filtros de
visibilidade continuam aplicados aos palpites de terceiros e ao palpite da ida
usado no cálculo.

O dono configura o valor na criação ou em "Configurações do grupo". Alterar esse
valor recalcula o bônus dos confrontos encerrados e o ranking do grupo. A API aplica
configuração, bônus e ranking no mesmo batch transacional, preservando pontos de
placar e pênaltis. A atualização não altera outros grupos nem as marcações de jogos
já pontuados. O cron lê o valor vigente da regra ao gravar o bônus de classificado.

## Regras do grupo na interface

Qualquer membro abre "Regras do grupo" pelo menu "Opções do grupo" ou pelo link
"Como pontua" abaixo do ranking. O texto vem de `web/src/lib/groupRules.ts` e usa os
campos que `GET /groups/:id` já devolve. Os bônus de classificado e pênaltis só
aparecem em competição com `type = 'cup'` e quando o valor é maior que zero. O ranking
mostra a ordem do `ORDER BY` do servidor: pontos, placares exatos e
quem entrou primeiro. Os exatos saem da lista quando o placar exato não vale mais
que o resultado, porque nesse caso `exact_hits` fica sempre em zero.

## Observabilidade

`logEvent('group_created', ...)` carrega `predictions_visibility` (blob5) e
`points_exact`/`points_winner` (doubles). Ver [`observability.md`](observability.md).
Os cliques novos da modal/MatchCard estão em [`analytics.md`](analytics.md).
