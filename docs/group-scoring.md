# Configuração de pontuação e visibilidade por grupo

Cada grupo define, **na criação**, como os palpites são pontuados e quem enxerga os
palpites alheios. A configuração é **imutável** depois de criada (`PATCH /groups/:id`
só aceita `name`). Grupos antigos herdam os defaults via `migration 0008` — sem recálculo
de leaderboard.

## Campos (tabela `groups`)

| Campo | Tipo | Default | Restrição |
|---|---|---|---|
| `points_exact` | INTEGER 0–10 | 3 | Pontos por acertar o placar exato |
| `points_winner` | INTEGER 0–10 | 1 | Pontos por acertar só o vencedor/empate |
| `points_penalty` | INTEGER 0–10 | 1 | Bônus por acertar o vencedor dos pênaltis (`migration 0010`) |
| `predictions_visibility` | `'hidden'` \| `'public'` | `'hidden'` | Visibilidade dos palpites alheios |

## Invariantes (validadas na API **e** no front)

1. Ambos inteiros em `0..10`.
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

Elegibilidade **não** é "todo mata-mata". Cada competição lista em
`competitions.penalty_phases` (JSON de `stage`s) as fases que vão a pênalti em jogo único.
Comp/fase fora da lista = **fail-closed** (nunca pede nem pontua pênalti — ligas, ida-e-volta).
O parse é no Worker (`matchGoesToPenalties` / `parsePenaltyPhases`), nunca SQL `json_each`.
A API de matches devolve `decides_on_penalties` por jogo; o front fica burro. MVP semeia só
a Copa (`fifa-world-cup-2026`).

### Placar canônico (regressão do bug do `fullTime`)

O palpite compara contra `regularTime + extraTime` (sem os gols de pênalti). Em
`PENALTY_SHOOTOUT` o `fullTime` da football-data **inclui** os pênaltis, então `sync.ts`
grava o canônico (`home_score`/`away_score`) e guarda os gols de pênalti à parte
(`home_penalty_goals`/`away_penalty_goals`) + `penalty_winner` para display "1-1 (5-4
pênaltis)".

### Por que `penalty_points` é coluna separada

`recalculateLeaderboard` infere `exact_hits` por `points_awarded == points_exact`. Somar o
bônus em `points_awarded` quebraria essa detecção. Logo: `points_awarded` = só base,
`penalty_points` = bônus; o leaderboard soma `points_awarded + penalty_points` como
`total_points`. Re-scorar reescreve `penalty_points` (0 quando não aplicável) — sem reset
manual.

## Visibilidade

- `hidden` (default): anti-cópia — o palpite alheio para um jogo só aparece depois que o
  usuário palpitou naquele jogo **ou** o jogo começou. Enforçada server-side em
  `GET /predictions/group`.
- `public`: todos veem todos em tempo real, sem filtro (opt-in explícito do criador).

A visibilidade é sempre resolvida no servidor a partir do banco — o front nunca decide o que
revelar. O `points_exact` enviado ao front é só para a UI; a pontuação real usa os valores do
banco em `scoreMatch`.

### Onde o pênalti aparece no front

- **Aba Palpitar** (`MatchCard`): num jogo elegível, o seletor "Quem vence nos pênaltis?"
  fica sempre renderizado, mas **mutado** (`penaltyPickerMuted`) enquanto o placar não é
  empate — empate (inclusive o default `0×0`) ativa. Em empate elegível o vencedor é
  obrigatório antes de salvar.
- **"Salvar todos"** (`PredictionsTab.collectRoundDrafts`): inclui o jogo quando há draft de
  placar **ou** só de pênalti. Sem isso, um empate `0×0` default — que nunca gera draft de
  placar — seria descartado silenciosamente junto com o vencedor escolhido.
- **Aba Grupo** (`GroupPicksTab`): para um palpite de empate em jogo elegível, mostra o
  vencedor escolhido (`⚽ <time>`) ao lado do placar — é o que distingue dois `1 × 1` iguais.
  Os pontos exibidos somam base + bônus (`points_awarded + penalty_points`), igual ao
  leaderboard.

## Observabilidade

`logEvent('group_created', ...)` carrega `predictions_visibility` (blob5) e
`points_exact`/`points_winner` (doubles). Ver [`observability.md`](observability.md).
Os cliques novos da modal/MatchCard estão em [`analytics.md`](analytics.md).
