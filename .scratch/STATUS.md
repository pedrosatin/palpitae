# Palpitae

Fase: running
Resumo: Bolões de futebol entre amigos, com palpites por partida, grupos privados e classificação.
Atualizado: 2026-10-10

## Sobre
Permite entrar com Google, criar grupos de bolão e convidar amigos por código ou link. Os participantes enviam placares e disputam a classificação conforme os resultados das partidas e as regras de pontuação do grupo.

A interface usa React e a API usa Cloudflare Workers com Hono e D1. Rotinas agendadas acompanham partidas, calculam pontos e enviam lembretes, conforme o [README](../README.md).

## Funcionalidades
- Login com Google e sessão por cookie [live]
- Grupos privados com convites por código ou link [live]
- Palpites por rodada e salvamento de vários placares [live]
- Classificação dos participantes e pontuação configurável [live]
- Atualização de resultados e lembretes por rotinas agendadas
- Encerramento das sessões em todos os dispositivos

## Status
- A [página pública](https://palpitae.com.br/) apresenta os grupos, os palpites e a pontuação. As operações autenticadas não foram repetidas nesta atualização.
- O histórico local inclui as correções de acesso a grupos, privacidade e quotas na [PR #471](https://github.com/pedrosatin/palpitae/pull/471), trava de palpites na [#472](https://github.com/pedrosatin/palpitae/pull/472) e sessões na [#473](https://github.com/pedrosatin/palpitae/pull/473). A disponibilidade dessas correções em produção precisa de conferência própria.
- A consulta ao GitHub não encontrou PRs abertas. A rotina Radar Sync mais recente terminou com sucesso.

## Em andamento

## Perguntas abertas

## Decisões recentes
