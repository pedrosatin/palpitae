# Dashboard Nativo (Admin Metrics) — ideias futuras

Backlog de ideias para o `/admin/metricas`. O que já foi implementado sai deste
arquivo — o estado atual do dashboard (arquitetura, endpoints, o que cada seção
mostra) está documentado em [`docs/observability.md`](observability.md), e o
esquema posicional dos eventos idem (fonte de verdade única, não duplicar aqui).

## Ideias pendentes

### Linha de referência de quota da API Football

O gráfico de chamadas/dia já existe; falta uma linha de referência visual do
teto. **Atenção à premissa:** o provedor é o football-data.org, cujo free tier
limita por **taxa (10 req/min)**, não por total diário — não existe "100
chamadas/dia" (isso é da API-Football, outro provedor). Se fizer, o teto deve
ser configurável e documentado, senão vira alarme falso.

## Descartado — NÃO re-propor

- **Métrica de conversão de e-mail (ROI do lembrete):** cruzar
  `email_reminder_sent` com palpites do mesmo usuário no mesmo dia exige join,
  e a SQL API do Analytics Engine não faz join. O gráfico diário empilhado já
  permite ver a olho nu se pico de palpite segue dia de disparo. Não vale código.
- **Pizza/gauge para cache hit rate:** o KPI card com o percentual já responde
  a pergunta.
